cmake_minimum_required(VERSION 3.20)
project(wdk7_e2e C)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/../../../cmake")
find_package(DbgEng REQUIRED)

wdk7_add_exe(e2e_cli exe.c)
wdk7_add_dll(e2e_dll dll.c)
wdk7_add_lib(e2e_lib lib.c)
wdk7_add_sys(e2e_sys WDM sys.c)
wdk7_add_exe(e2e_dbgeng dbgeng.c)
target_link_libraries(e2e_dbgeng PRIVATE DbgEng::DbgEng)
