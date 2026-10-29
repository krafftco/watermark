-- The house's doors, as the command line uses them: pair by a code, then each file into the vault.
local LrHttp = import 'LrHttp'
local LrTasks = import 'LrTasks'
local LrPasswords = import 'LrPasswords'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'
local J = require 'json'

local A = {}
A.DEFAULT = 'https://watermark.krafftco.com'
local function house(s) local h = (s and s.house and s.house ~= '') and s.house or A.DEFAULT; return (h:gsub('/+$', '')) end
A.house = house
function A.key(s) return LrPasswords.retrieve('watermark:' .. house(s)) end
function A.forget(s) LrPasswords.store('watermark:' .. house(s), nil) end

local function call(s, path, body, method)
  local h = { { field = 'Content-Type', value = 'application/json' }, { field = 'Accept', value = 'application/json' } }
  local k = A.key(s); if k then h[#h + 1] = { field = 'Authorization', value = 'Bearer ' .. k } end
  local out, hdr
  if body then out, hdr = LrHttp.post(house(s) .. path, J.encode(body), h, method or 'POST', 120)
  else out, hdr = LrHttp.get(house(s) .. path, h, 60) end
  local st = hdr and hdr.status or 0
  return (out and J.decode(out)) or {}, st
end
A.call = call

-- Pairing: the house gives a code, the browser opens where the maker is signed in, the yes gives a key once.
function A.login(s, name, say)
  local b = call(s, '/api/push/begin', { name = name or 'Lightroom Classic' })
  if not b.ok then return nil, (b.error or 'The house did not answer.') end
  say('Your code is ' .. b.code .. '. Say yes in the browser.')
  LrHttp.openUrlInBrowser(b.url)
  for _ = 1, 200 do
    LrTasks.sleep(b.every or 3)
    local p, st = call(s, '/api/push/poll', { device = b.device })
    if p.key then LrPasswords.store('watermark:' .. house(s), p.key); return p.maker or {} end
    if st ~= 200 then return nil, (p.error or 'Not allowed.') end
  end
  return nil, 'The code ran out. Try again.'
end

local function sha256(data)
  local ok, d = pcall(function() local LrDigest = import 'LrDigest'; return LrDigest.SHA256.digest(data) end)
  if ok and type(d) == 'string' and d:match('^%x+$') and #d == 64 then return d:lower() end
  return nil
end

-- One file: ask (by fingerprint; the house never takes the same bytes twice), send it whole through the house, then
-- wait for the house to read it and say which work it is.
function A.send(s, file, meta)
  local f = io.open(file, 'rb'); if not f then return nil, 'Could not read the rendered file.' end
  local data = f:read('*a'); f:close()
  local name = LrPathUtils.leafName(file)
  local st = call(s, '/account/arrivals/start', { name = name, size = #data, type = name:lower():match('%.tiff?$') and 'image/tiff' or 'image/jpeg',
    sha256 = sha256(data), title = meta.title or '', place = meta.place or '', replaces = meta.replaces, import_id = meta.import_id })
  if not st.ok then return nil, (st.error or 'The vault refused it.') end
  if st.already then return st.slug or meta.replaces, nil, 'held' end
  local hdr = { { field = 'Content-Type', value = 'application/octet-stream' }, { field = 'Authorization', value = 'Bearer ' .. (A.key(s) or '') } }
  local out, h = LrHttp.post(house(s) .. '/account/arrivals/' .. st.id .. '/body', data, hdr, 'PUT', 1800, #data)
  local j = out and J.decode(out) or {}
  if not (h and h.status == 200 and j.ok) then return nil, (j.error or 'The file did not arrive; publish it again.') end
  data = nil
  for _ = 1, 600 do
    LrTasks.sleep(2)
    local r = call(s, '/account/arrivals/state?ids=' .. st.id)
    local a = r.asked and r.asked[1]
    if a and a.status == 'done' then return a.slug, nil, a.outcome end
    if a and a.status == 'failed' then return nil, (a.error or 'The house could not read it.') end
  end
  return nil, 'The house is still reading it; it will appear in your studio.'
end

return A
