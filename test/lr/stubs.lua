-- Lightroom's toolkit, enough of it to run the plug-in's house calls under plain Lua 5.1 (curl does the HTTP).
local vault = {}
local function sh(s) return "'" .. tostring(s):gsub("'", "'\\''") .. "'" end
local function http(method, url, body, headers)
  local cmd = 'curl -s -X ' .. method .. ' -w "\\n%{http_code}"'
  for _, h in ipairs(headers or {}) do cmd = cmd .. ' -H ' .. sh(h.field .. ': ' .. h.value) end
  if body then local t = os.tmpname(); local f = io.open(t, 'wb'); f:write(body); f:close(); cmd = cmd .. ' --data-binary @' .. t end
  local p = io.popen(cmd .. ' ' .. sh(url)); local out = p:read('*a'); p:close()
  local b, code = out:match('^(.*)\n(%d+)$'); return b, { status = tonumber(code) }
end
local M = {
  LrHttp = { post = function(u, b, h, m) return http(m or 'POST', u, b, h) end, get = function(u, h) return http('GET', u, nil, h) end,
    openUrlInBrowser = function(u) local f = io.open(os.getenv('LR_URLFILE'), 'w'); f:write(u); f:close() end },
  LrTasks = { sleep = function(s) os.execute('sleep 0.2') end },
  LrPasswords = { store = function(k, v) vault[k] = v end, retrieve = function(k) return vault[k] end },
  LrFileUtils = {}, LrPathUtils = { leafName = function(p) return p:match('[^/]+$') end },
}
function import(n) if M[n] then return M[n] end error('no ' .. n) end
