-- A small JSON for the house's answers (Lightroom carries none).
local J = {}
local esc = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
local function enc(v)
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return v and 'true' or 'false' end
  if t == 'number' then return (v == math.floor(v)) and string.format('%d', v) or tostring(v) end
  if t == 'string' then return '"' .. v:gsub('[%c"\\]', function(c) return esc[c] or string.format('\\u%04x', c:byte()) end) .. '"' end
  if t == 'table' then
    if #v > 0 or next(v) == nil then local o = {} for i = 1, #v do o[i] = enc(v[i]) end return '[' .. table.concat(o, ',') .. ']' end
    local o = {} for k, x in pairs(v) do o[#o + 1] = enc(tostring(k)) .. ':' .. enc(x) end return '{' .. table.concat(o, ',') .. '}'
  end
  return 'null'
end
J.encode = enc
function J.decode(s)
  local i = 1
  local function ws() i = s:find('[^ \t\r\n]', i) or #s + 1 end
  local val
  local function str()
    local out, j = {}, i + 1
    while true do
      local c = s:sub(j, j)
      if c == '' then error('bad json') end
      if c == '"' then i = j + 1 return table.concat(out) end
      if c == '\\' then
        local n = s:sub(j + 1, j + 1)
        if n == 'u' then local cp = tonumber(s:sub(j + 2, j + 5), 16) or 63
          if cp < 128 then out[#out + 1] = string.char(cp) elseif cp < 2048 then out[#out + 1] = string.char(192 + math.floor(cp / 64), 128 + cp % 64)
          else out[#out + 1] = string.char(224 + math.floor(cp / 4096), 128 + math.floor(cp / 64) % 64, 128 + cp % 64) end
          j = j + 6
        else out[#out + 1] = ({ b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' })[n] or n; j = j + 2 end
      else out[#out + 1] = c; j = j + 1 end
    end
  end
  val = function()
    ws(); local c = s:sub(i, i)
    if c == '{' then local o = {}; i = i + 1; ws(); if s:sub(i, i) == '}' then i = i + 1 return o end
      while true do ws(); local k = str(); ws(); i = i + 1; o[k] = val(); ws(); local d = s:sub(i, i); i = i + 1; if d == '}' then return o end end
    elseif c == '[' then local o = {}; i = i + 1; ws(); if s:sub(i, i) == ']' then i = i + 1 return o end
      while true do o[#o + 1] = val(); ws(); local d = s:sub(i, i); i = i + 1; if d == ']' then return o end end
    elseif c == '"' then return str()
    elseif s:sub(i, i + 3) == 'true' then i = i + 4 return true
    elseif s:sub(i, i + 4) == 'false' then i = i + 5 return false
    elseif s:sub(i, i + 3) == 'null' then i = i + 4 return nil
    else local n = s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', i); i = i + #n; return tonumber(n) end
  end
  local ok, r = pcall(val); if ok then return r end
  return nil
end
return J
