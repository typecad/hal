@echo off
set CF_CARRAY_DEBUG=1
cd /d C:\typecad\typecode\packages\framework-native
call npx vitest run -t "17-buffer-operations" 1>nul 2>nul
echo ===LOG===
if exist .build\tests\17_buffer_operations\cf-carray.log (type .build\tests\17_buffer_operations\cf-carray.log) else (echo NO LOG FOUND)
