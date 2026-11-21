"use strict";

async function selectPreviewQuality(page, value) {
  const quality = page.locator('[aria-label="Preview quality"]');
  if (await quality.evaluate(element => element.tagName === "SELECT")) return quality.selectOption(value);
  const overflow = page.locator(".zoidium-player-plus-overflow");
  if (!await quality.isVisible()) await overflow.click();
  await quality.click();
  const label = value === "1" ? "Full quality" : "1/8 quality";
  await page.getByRole("menuitemradio", { name: label }).click();
  if (await overflow.getAttribute("aria-expanded") === "true") await overflow.click();
}


module.exports = { selectPreviewQuality };
