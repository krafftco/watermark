--[[ Watermark for Lightroom Classic: a Publish Service.
Publish a collection to your Watermark vault: every photograph goes in as the maker's own master, at full size,
with the title, caption, keywords, place and stars you gave it here; an edited photograph re-published becomes the
new master of the same work (the record, the deed and every licence stay). Nothing here touches your catalogue. ]]
return {
  LrSdkVersion = 10.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = 'com.krafftco.watermark',
  LrPluginName = 'Watermark',
  LrPluginInfoUrl = 'https://watermark.krafftco.com/lightroom',
  LrExportServiceProvider = { title = 'Watermark', file = 'WatermarkPublish.lua' },
  VERSION = { major = 1, minor = 0, revision = 0, build = 1 },
}
