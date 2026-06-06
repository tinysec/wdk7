cmake_minimum_required(VERSION 3.20)
project(wdk7_e2e_sys C)

add_executable(e2e_sys ../cmake/sys.c)
set_target_properties(e2e_sys PROPERTIES SUFFIX ".sys")

if (WDK7_ARCH STREQUAL "i386")
    set(_e2e_sys_entry "GsDriverEntry@8")
else()
    set(_e2e_sys_entry "GsDriverEntry")
endif()

target_link_libraries(e2e_sys PRIVATE ntoskrnl hal wmilib BufferOverflowK)
target_link_options(e2e_sys PRIVATE
        /DRIVER
        /SUBSYSTEM:NATIVE
        "/ENTRY:${_e2e_sys_entry}")
