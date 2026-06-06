cmake_minimum_required(VERSION 3.20)
project(wdk7_e2e C)

include(FetchContent)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/../../../cmake")
find_package(DbgEng REQUIRED)

add_executable(e2e_cli exe.c)
add_library(e2e_dll SHARED dll.c)
add_library(e2e_lib STATIC lib.c)
add_executable(e2e_dbgeng dbgeng.c)
target_link_libraries(e2e_dbgeng PRIVATE DbgEng::DbgEng)

FetchContent_Declare(
    e2e_fetch_dep
    SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/fetch_dep"
)
FetchContent_MakeAvailable(e2e_fetch_dep)

add_executable(e2e_native native.c)
target_link_libraries(e2e_native PRIVATE e2e_fetch_dep)
