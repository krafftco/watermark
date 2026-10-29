-- The Publish Service: a collection in Lightroom is a set of works in your Watermark vault.
local LrView = import 'LrView'
local LrDialogs = import 'LrDialogs'
local LrTasks = import 'LrTasks'
local LrFileUtils = import 'LrFileUtils'
local LrHttp = import 'LrHttp'
local A = require 'WatermarkAPI'

local P = {}
P.supportsIncrementalPublish = 'only'
P.titleForPublishedCollection = 'Watermark collection'
P.allowFileFormats = { 'JPEG', 'TIFF' }
P.hideSections = { 'exportLocation', 'fileNaming', 'video' }
P.hidePrintResolution = true
P.canExportVideo = false
P.exportPresetFields = {
  { key = 'house', default = A.DEFAULT },
  { key = 'who', default = '' },
  { key = 'placeFrom', default = 'city' }, -- city | sublocation | none
}
-- The master, never an export for the web: full size, JPEG at 100 (or TIFF), every word of metadata, no sharpening for screen.
function P.updateExportSettings(e)
  if e.LR_format ~= 'TIFF' then e.LR_format = 'JPEG'; e.LR_jpeg_quality = 1 end
  e.LR_size_doConstrain = false
  e.LR_outputSharpeningOn = false
  e.LR_embeddedMetadataOption = 'all'
  e.LR_minimizeEmbeddedMetadata = false
end

local function status(props)
  if A.key(props) then props.who = props.who ~= '' and props.who or 'Signed in'; props.signedIn = true
  else props.who = 'Not signed in'; props.signedIn = false end
end

function P.startDialog(props) status(props) end

function P.sectionsForTopOfDialog(f, props)
  local bind = LrView.bind
  return { {
    title = 'Watermark',
    synopsis = bind 'who',
    f:row { f:static_text { title = 'Your vault at', width = 120 }, f:edit_field { value = bind 'house', width_in_chars = 32 } },
    f:row { f:static_text { title = bind 'who', fill_horizontal = 1 },
      f:push_button { title = 'Sign in', enabled = LrView.bind { key = 'signedIn', transform = function(v) return not v end }, action = function()
        LrTasks.startAsyncTask(function()
          local m, err = A.login(props, 'Lightroom Classic', function(t) props.who = t end)
          if m then props.who = 'Signed in as ' .. (m.name or 'you'); props.signedIn = true else props.who = 'Not signed in'; LrDialogs.message('Watermark', err or 'Not signed in.') end
        end)
      end },
      f:push_button { title = 'Sign out', enabled = bind 'signedIn', action = function() A.forget(props); status(props) end } },
    f:row { f:static_text { title = 'The place', width = 120 }, f:popup_menu { value = bind 'placeFrom', items = {
      { title = 'City (with the sublocation)', value = 'city' }, { title = 'Sublocation only', value = 'sublocation' }, { title = 'Leave it to the file', value = 'none' } } } },
    f:static_text { title = 'Each photograph goes in at full size, private until you publish it on Watermark. Re-publish an edited photograph and it becomes the new master of the same work.', width_in_chars = 60, height_in_lines = 3 },
  } }
end

local function placeOf(photo, how)
  if how == 'none' then return '' end
  local city = photo:getFormattedMetadata('city') or ''
  local sub = photo:getFormattedMetadata('location') or ''
  if how == 'sublocation' then return sub ~= '' and sub or city end
  if city ~= '' and sub ~= '' and sub ~= city then return sub .. ', ' .. city end
  return city ~= '' and city or sub
end

function P.processRenderedPhotos(ctx, exportContext)
  local s = exportContext.propertyTable
  if not A.key(s) then LrDialogs.message('Watermark', 'Sign in first: open the publish service’s settings and press Sign in.'); return end
  local session = exportContext.exportSession
  local n = session:countRenditions()
  local progress = exportContext:configureProgress { title = n == 1 and 'Publishing one photograph to Watermark' or ('Publishing ' .. n .. ' photographs to Watermark') }
  local fails = {}
  for i, rendition in exportContext:renditions { stopIfCanceled = true } do
    progress:setPortionComplete((i - 1) / n)
    local photo = rendition.photo
    local ok, path = rendition:waitForRender()
    if ok then
      local slug, err, outcome = A.send(s, path, { title = photo:getFormattedMetadata('title') or '', place = placeOf(photo, s.placeFrom), replaces = rendition.publishedPhotoId })
      if slug then rendition:recordPublishedPhotoId(slug); rendition:recordPublishedPhotoUrl(A.house(s) .. '/w/' .. slug)
      else rendition:uploadFailed(err or 'Not sent'); fails[#fails + 1] = (photo:getFormattedMetadata('fileName') or '?') .. ': ' .. (err or '') end
      LrFileUtils.delete(path)
    else rendition:uploadFailed(path); fails[#fails + 1] = path end
  end
  progress:done()
  if #fails > 0 then LrDialogs.message('Watermark', #fails .. ' not sent', table.concat(fails, '\n')) end
end

-- Removing from a collection never removes a work from your vault: the house keeps what it was given.
function P.deletePhotosFromPublishedCollection(s, ids, deletedCallback)
  for _, id in ipairs(ids) do deletedCallback(id) end
end
function P.metadataThatTriggersRepublish() return { default = false, title = true, caption = true, keywords = true, rating = true, location = true, city = true, stateProvince = true, country = true } end
function P.goToPublishedPhoto(s, info) if info.publishedPhoto then LrHttp.openUrlInBrowser(info.publishedPhoto:getRemoteUrl()) end end
function P.goToPublishedCollection(s) LrHttp.openUrlInBrowser(A.house(s) .. '/account/table') end

return P
