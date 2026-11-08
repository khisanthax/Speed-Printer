import {expect,test} from '@playwright/test';
test('approved columns, synchronized settings and honest empty summaries',async({page})=>{
  await page.goto('');
  await expect(page.getByRole('heading',{name:'A — Current Printer'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'B — Target Printer'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'C — Live Tuning'})).toBeVisible();
  await expect(page.locator('.time-metric strong')).toHaveText(['—','—','—']);
  await page.locator('.settings-scroll').first().evaluate(e=>{e.scrollTop=120;e.dispatchEvent(new Event('scroll'));});
  const positions=await page.locator('.settings-scroll').evaluateAll(es=>es.map(e=>e.scrollTop));
  expect(new Set(positions).size).toBe(1);
  await page.getByRole('spinbutton',{name:'Outer wall speed value'}).fill('250');
  await expect(page.locator('#summary-2')).toContainText('Pending');
  await page.screenshot({path:'.local/desktop.png',fullPage:true});
});
test('save and load experiments and print lab missing-data states',async({page})=>{
  await page.goto('');await page.getByRole('button',{name:'♧ Save Preset',exact:true}).click();
  await page.locator('#preset-name').fill('Test experiment');await page.locator('#confirm-save').click();
  await page.getByRole('button',{name:'Saved Presets',exact:false}).click();
  await expect(page.locator('.saved-card')).toContainText('Test experiment');
  await page.getByRole('button',{name:'Load',exact:true}).click();
  await expect(page.locator('#summary-2')).toContainText('re-slice required');
  await page.getByRole('button',{name:'Print Lab',exact:false}).click();await page.getByRole('button',{name:'Show labeled demo history'}).click();
  await expect(page.locator('#lab-results')).toContainText('DEMO FIXTURE');
  await expect(page.locator('#lab-results')).toContainText('Not comparable');
});
