cmake_minimum_required(VERSION 3.20)
project(wdk7_e2e C)

include(FetchContent)

add_executable(e2e_cli exe.c)
add_library(e2e_dll SHARED dll.c)
add_library(e2e_lib STATIC lib.c)
add_executable(e2e_dbgeng dbgeng.c)

if (WDK7_ARCH STREQUAL "amd64")
    set(_dbgeng_lib "$ENV{WDK7_DBGENG_LIB_AMD64}")
else()
    set(_dbgeng_lib "$ENV{WDK7_DBGENG_LIB_I386}")
endif()

if ("$ENV{WDK7_DBGENG_INCLUDE_DIR}" STREQUAL "" OR "${_dbgeng_lib}" STREQUAL "")
    message(FATAL_ERROR "DbgEng SDK environment variables are not set.")
endif()

target_include_directories(e2e_dbgeng PRIVATE "$ENV{WDK7_DBGENG_INCLUDE_DIR}")
target_link_directories(e2e_dbgeng PRIVATE "${_dbgeng_lib}")
target_link_libraries(e2e_dbgeng PRIVATE dbgeng dbghelp)

FetchContent_Declare(
    e2e_fetch_dep
    SOURCE_DIR "${CMAKE_CURRENT_LIST_DIR}/fetch_dep"
)
FetchContent_MakeAvailable(e2e_fetch_dep)

add_executable(e2e_native native.c)
target_link_libraries(e2e_native PRIVATE e2e_fetch_dep)
