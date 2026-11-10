const puppeteer = require('puppeteer-core');
const {execFileSync} = require('child_process');
const crypto = require('crypto');
const path = require('path');
(async () => {
  if (!process.env.AQ_PAGE_PASSWORD) throw Error('Missing authorized credential');
  const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1440,height:1000});
    const response = await page.goto('https://aquarius.limaretail.com/',{waitUntil:'domcontentloaded'});
    if (response.status() !== 200) throw Error('Production unavailable');
    const hash = crypto.createHash('sha256').update(await response.buffer()).digest('hex');
    await page.waitForFunction(() => document.querySelector('#gate-submit')?.disabled === false);
    await page.type('#gate-password',process.env.AQ_PAGE_PASSWORD);
    await page.click('#gate-submit');
    await page.waitForSelector('#aquarius-sidebar',{timeout:60000});
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /Generación de Reporte/.test(b.textContent)).click());
    await page.waitForSelector('#week-select option[value="2026-11"]',{timeout:60000});
    await page.select('#week-select','2026-11');
    await page.waitForSelector('#week-doc > section:nth-child(3) svg.rp-chart-week',{timeout:60000});
    const chart = await page.$eval('#week-doc > section:nth-child(3) svg.rp-chart-week',svg => ({
      lines:[...svg.querySelectorAll('line[stroke]')].map(e=>({color:e.getAttribute('stroke')})),
      points:svg.querySelectorAll('circle').length
    }));
    if(chart.lines.length < 2 || chart.points < 3) throw Error('Chart has no series');
    // Exercise the actual production download handler. Chromium writes the PDF
    // instead of opening an interactive print dialog; report DOM/CSS stay intact.
    await page.evaluate(() => {window.__printCalled=false;window.print=()=>{window.__printCalled=true;};});
    await page.click('#week-print');
    await page.waitForFunction(()=>window.__printCalled);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#week-doc img')].map(i=>i.decode()));});
    const pdf = Buffer.from(await page.pdf({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false}));
    const result = execFileSync('python',[path.join(__dirname,'verify-production-chart.py')],{
      input:JSON.stringify({pdf:pdf.toString('base64'),chart}),encoding:'utf8',maxBuffer:1024*1024
    });
    console.log('AQUARIUS_PRODUCTION_PDF',JSON.stringify({url:'https://aquarius.limaretail.com/',html_sha256:hash,real_download_handler:true,...JSON.parse(result)}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
