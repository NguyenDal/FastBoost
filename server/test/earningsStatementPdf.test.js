const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEarningsStatement } = require('../src/utils/earningsStatementPdf');
const base = { period:{month:'2026-09',label:'September 2026',startsAt:'2026-09-01T05:00:00Z',endsAt:'2026-10-01T05:00:00Z',closed:true},activatedAt:'2026-09-01T05:00:00Z',timeZone:'America/Winnipeg',booster:{displayName:'Nguyễn Sample'},totals:[],entries:[] };
test('closed empty periods produce a complete PDF; open periods cannot be finalized', async () => {
    const pdf = await renderEarningsStatement(base);
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    assert.match(pdf.subarray(-40).toString(),/%%EOF/);
    assert.throws(()=>renderEarningsStatement({...base,period:{...base.period,closed:false}}));
});
test('long statements support multiple currencies, negative adjustments and multiple pages', async () => {
    const entries = Array.from({length:80},(_,id)=>({id,orderNumber:`TEST-${id}`,serviceTitle:'Rank Boost - a long service description that needs to wrap without clipping',currency:id%2?'CAD':'USD',amountCents:id===79?-7000:7000,kind:id===79?'ADJUSTMENT':'EARNED',recognizedAt:'2026-09-16T18:00:00Z'}));
    const pdf = await renderEarningsStatement({...base,totals:[{currency:'USD',amountCents:280000},{currency:'CAD',amountCents:266000}],entries});
    assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=3);
    assert.match(pdf.subarray(-40).toString(),/%%EOF/);
});
