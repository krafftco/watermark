package.path = os.getenv('LR_PLUGIN') .. '/?.lua;' .. package.path
dofile(os.getenv('LR_STUBS'))
local A = require 'WatermarkAPI'
local s = { house = os.getenv('LR_HOUSE') }
local m, err = A.login(s, 'Lightroom Classic', function(t) io.stderr:write(t .. '\n') end)
assert(m, err); print('signed in ' .. tostring(m.name))
local slug, e1, o1 = A.send(s, arg[1], { title = 'From Lightroom', place = 'Philadelphia' }); assert(slug, e1); print('first ' .. slug .. ' ' .. tostring(o1))
local s2, e2, o2 = A.send(s, arg[1], { replaces = slug }); print('again ' .. tostring(s2) .. ' ' .. tostring(o2))
local s3, e3, o3 = A.send(s, arg[2], { replaces = slug }); assert(s3, e3); print('edit ' .. s3 .. ' ' .. tostring(o3))
