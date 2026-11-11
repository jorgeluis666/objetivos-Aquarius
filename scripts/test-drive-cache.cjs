const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
for (const [repo,name,prefix] of [['objetivos-Aquarius', 'Aquarius', 'AQUARIUS']]) {
  const source=fs.readFileSync(require('node:path').join(__dirname,'../js/drive-sync.js'),'utf8');
  for (const stamp of ['2026-10-20T00:29:00Z','2026-11-09T01:00:00Z']) {
    const published={months:[{id:'2026-11'}],drive:{lastSync:'2026-11-08T23:26:03Z'}};
    const cached={months:[{id:'2026-11'}],drive:{lastSync:stamp}};
    let state=null;
    const window={localStorage:{getItem:()=>JSON.stringify(cached)},addEventListener(){},removeEventListener(){}};
    window[`${prefix}_RETAIL_DATA`]=published;
    window[`${prefix}_DRIVE_CONFIG`]={folderId:'configured',apiKey:''};
    window[`${name}Dashboard`]={getData:()=>state,applyData:d=>{state=d;window[`${prefix}_RETAIL_DATA`]=d;}};
    vm.runInNewContext(source,{window,document:{addEventListener(){}},console,URL,Date,setTimeout,clearTimeout});
    assert.equal(window[`${prefix}_RETAIL_DATA`].drive.lastSync,stamp>published.drive.lastSync?stamp:published.drive.lastSync);
  }
  console.log(`${repo}: cache vieja rechazada; cache nueva conservada antes de DOMContentLoaded`);
}
