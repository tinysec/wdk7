# WDK7-only CMake toolchain.
#
# Usage:
#   cmake -S . -B build-wdk7 -G "NMake Makefiles" ^
#     -DCMAKE_TOOLCHAIN_FILE=cmake/wdk7.cmake ^
#     -DWDK7_ARCH=amd64
#
# This file intentionally supports only Windows Driver Kit 7.1
# (7600.16385.1). It is a generic toolchain: it selects the WDK7 compiler,
# target architecture, and SDK paths. User-mode and kernel-mode build semantics
# are applied per target with wdk7_target_user(), wdk7_target_kernel(), or the
# wdk7_add_* helpers.

cmake_minimum_required(VERSION 3.20)

if (CMAKE_C_COMPILER_LOADED OR CMAKE_CXX_COMPILER_LOADED)
    foreach (_lang C CXX)
        if (CMAKE_${_lang}_COMPILER_ID STREQUAL "MSVC")
            set(CMAKE_${_lang}_CREATE_STATIC_LIBRARY
                    "\"${CMAKE_LINKER}\" /lib /nologo <LINK_FLAGS> /OUT:<TARGET> <OBJECTS>")
        endif()
    endforeach()
    return()
endif()

include_guard(GLOBAL)

set(CMAKE_SYSTEM_NAME Windows)

set(CMAKE_C_COMPILER_WORKS           TRUE CACHE INTERNAL "")
set(CMAKE_CXX_COMPILER_WORKS         TRUE CACHE INTERNAL "")
set(CMAKE_C_COMPILER_FORCED          TRUE)
set(CMAKE_CXX_COMPILER_FORCED        TRUE)
set(CMAKE_DETERMINE_C_ABI_COMPILED   TRUE CACHE INTERNAL "")
set(CMAKE_DETERMINE_CXX_ABI_COMPILED TRUE CACHE INTERNAL "")
set(CMAKE_C_COMPILER_ID              "MSVC")
set(CMAKE_CXX_COMPILER_ID            "MSVC")

set(CMAKE_TRY_COMPILE_PLATFORM_VARIABLES
        WDK7_ROOT WDK7_ARCH)
set(CMAKE_USER_MAKE_RULES_OVERRIDE
        "${CMAKE_CURRENT_LIST_FILE}"
        CACHE FILEPATH "WDK7 make rule overrides" FORCE)

if (NOT DEFINED WDK7_ROOT OR WDK7_ROOT STREQUAL "")
    if (DEFINED ENV{WDK7_ROOT})
        set(WDK7_ROOT "$ENV{WDK7_ROOT}" CACHE PATH "WDK7 root")
    elseif (DEFINED ENV{W7BASE})
        set(WDK7_ROOT "$ENV{W7BASE}" CACHE PATH "WDK7 root")
    endif()
endif()

if (NOT DEFINED WDK7_ROOT OR WDK7_ROOT STREQUAL "")
    foreach (_base
            "C:/WinDDK/7600.16385.1"
            "C:/WinDDK")
        if (EXISTS "${_base}/bin/setenv.bat")
            set(WDK7_ROOT "${_base}" CACHE PATH "WDK7 root")
            break()
        endif()
    endforeach()
endif()

if (NOT DEFINED WDK7_ROOT OR WDK7_ROOT STREQUAL "")
    message(FATAL_ERROR "WDK7_ROOT not set. Pass -DWDK7_ROOT=... or set env W7BASE / WDK7_ROOT.")
endif()

file(TO_CMAKE_PATH "${WDK7_ROOT}" WDK7_ROOT)
string(REGEX REPLACE "/$" "" WDK7_ROOT "${WDK7_ROOT}")
set(WDK7_ROOT "${WDK7_ROOT}" CACHE PATH "WDK7 root" FORCE)
set(WDK7 TRUE CACHE BOOL "Building with the WDK7 toolchain" FORCE)

if (NOT EXISTS "${WDK7_ROOT}/bin/setenv.bat"
        OR NOT EXISTS "${WDK7_ROOT}/inc/api"
        OR NOT EXISTS "${WDK7_ROOT}/inc/ddk")
    message(FATAL_ERROR "'${WDK7_ROOT}' is not a WDK7/WinDDK 7600.16385.1 tree.")
endif()

if (NOT DEFINED WDK7_ARCH OR WDK7_ARCH STREQUAL "")
    if (CMAKE_GENERATOR_PLATFORM MATCHES "^(Win32|x86)$")
        set(WDK7_ARCH "i386")
    else()
        set(WDK7_ARCH "amd64")
    endif()
endif()

if (WDK7_ARCH STREQUAL "x86" OR WDK7_ARCH STREQUAL "Win32")
    set(WDK7_ARCH "i386")
elseif (WDK7_ARCH STREQUAL "x64")
    set(WDK7_ARCH "amd64")
endif()

if (NOT (WDK7_ARCH STREQUAL "i386" OR WDK7_ARCH STREQUAL "amd64"))
    message(FATAL_ERROR "Unsupported WDK7_ARCH='${WDK7_ARCH}'. Use i386 or amd64.")
endif()

set(WDK7_ARCH "${WDK7_ARCH}" CACHE STRING "WDK7 target arch (i386|amd64)" FORCE)
set_property(CACHE WDK7_ARCH PROPERTY STRINGS i386 amd64)

if (WDK7_ARCH STREQUAL "amd64")
    set(_WDK7_TGT amd64)
    set(_WDK7_LIB amd64)
    set(CMAKE_SIZEOF_VOID_P 8)
    set(CMAKE_C_SIZEOF_DATA_PTR 8)
    set(CMAKE_CXX_SIZEOF_DATA_PTR 8)
    set(_WDK7_ARCH_DEFS /D_WIN64 /D_AMD64_ /DAMD64)
    set(_WDK7_ARCH_FLAGS /Zp8)
else()
    set(_WDK7_TGT x86)
    set(_WDK7_LIB i386)
    set(CMAKE_SIZEOF_VOID_P 4)
    set(CMAKE_C_SIZEOF_DATA_PTR 4)
    set(CMAKE_CXX_SIZEOF_DATA_PTR 4)
    set(_WDK7_ARCH_DEFS /D_X86_=1 /Di386=1 /DSTD_CALL)
    set(_WDK7_ARCH_FLAGS /Gm- /Gz)
endif()

set(WDK7_BIN    "${WDK7_ROOT}/bin/x86/${_WDK7_TGT}")
set(WDK7_HOST_BIN "${WDK7_ROOT}/bin/x86")
set(WDK7_CL     "${WDK7_BIN}/cl.exe")
set(WDK7_LINK   "${WDK7_BIN}/link.exe")
set(WDK7_RC     "${WDK7_HOST_BIN}/rc.exe")
set(WDK7_NMAKE  "${WDK7_HOST_BIN}/nmake.exe")

foreach (_tool IN ITEMS WDK7_CL WDK7_LINK WDK7_RC WDK7_NMAKE)
    if (NOT EXISTS "${${_tool}}")
        message(FATAL_ERROR "${_tool} not found: '${${_tool}}'")
    endif()
endforeach()

set(CMAKE_C_COMPILER   "${WDK7_CL}"   CACHE FILEPATH "" FORCE)
set(CMAKE_CXX_COMPILER "${WDK7_CL}"   CACHE FILEPATH "" FORCE)
set(CMAKE_LINKER       "${WDK7_LINK}" CACHE FILEPATH "" FORCE)
set(CMAKE_AR           "${WDK7_LINK}" CACHE FILEPATH "" FORCE)
set(CMAKE_RC_COMPILER  "${WDK7_RC}"   CACHE FILEPATH "" FORCE)

if (NOT CMAKE_MAKE_PROGRAM)
    set(CMAKE_MAKE_PROGRAM "${WDK7_NMAKE}" CACHE FILEPATH "" FORCE)
endif()

set(ENV{PATH} "${WDK7_BIN};${WDK7_HOST_BIN};$ENV{PATH}")

set(WDK7_USER_INCLUDE_DIRS
        "${WDK7_ROOT}/inc/api/crt/stl70"
        "${WDK7_ROOT}/inc/atl71"
        "${WDK7_ROOT}/inc/crt"
        "${WDK7_ROOT}/inc/api"
        "${WDK7_ROOT}/inc/ddk")
set(WDK7_KERNEL_INCLUDE_DIRS
        "${WDK7_ROOT}/inc/crt"
        "${WDK7_ROOT}/inc/ddk"
        "${WDK7_ROOT}/inc/api")

set(WDK7_USER_LIBRARY_DIRS
        "${WDK7_ROOT}/lib/win7/${_WDK7_LIB}"
        "${WDK7_ROOT}/lib/Crt/${_WDK7_LIB}"
        "${WDK7_ROOT}/lib/ATL/${_WDK7_LIB}")
set(WDK7_KERNEL_LIBRARY_DIRS
        "${WDK7_ROOT}/lib/win7/${_WDK7_LIB}"
        "${WDK7_ROOT}/lib/Crt/${_WDK7_LIB}")

set(WDK7_INCLUDE_DIRS "${WDK7_USER_INCLUDE_DIRS}")
set(WDK7_LIBRARY_DIRS "${WDK7_USER_LIBRARY_DIRS}")

set(CMAKE_C_STANDARD_INCLUDE_DIRECTORIES "" CACHE STRING "" FORCE)
set(CMAKE_CXX_STANDARD_INCLUDE_DIRECTORIES "" CACHE STRING "" FORCE)
set(CMAKE_RC_STANDARD_INCLUDE_DIRECTORIES "" CACHE STRING "" FORCE)
set(CMAKE_RC_FLAGS "" CACHE STRING "" FORCE)

set(CMAKE_EXE_LINKER_FLAGS    "/nologo /INCREMENTAL:NO /MANIFEST:NO" CACHE STRING "" FORCE)
set(CMAKE_SHARED_LINKER_FLAGS "/nologo /INCREMENTAL:NO /MANIFEST:NO" CACHE STRING "" FORCE)
set(CMAKE_MODULE_LINKER_FLAGS "/nologo /INCREMENTAL:NO /MANIFEST:NO" CACHE STRING "" FORCE)
foreach (_kind EXE SHARED MODULE)
    set(CMAKE_${_kind}_LINKER_FLAGS_DEBUG "/DEBUG /INCREMENTAL:NO" CACHE STRING "" FORCE)
    set(CMAKE_${_kind}_LINKER_FLAGS_RELWITHDEBINFO "/DEBUG /INCREMENTAL:NO" CACHE STRING "" FORCE)
    set(CMAKE_${_kind}_LINKER_FLAGS_RELEASE "/INCREMENTAL:NO" CACHE STRING "" FORCE)
    set(CMAKE_${_kind}_LINKER_FLAGS_MINSIZEREL "/INCREMENTAL:NO" CACHE STRING "" FORCE)
endforeach()

foreach (_lang C CXX)
    set(CMAKE_${_lang}_CREATE_STATIC_LIBRARY
            "\"${WDK7_LINK}\" /lib /nologo <LINK_FLAGS> /OUT:<TARGET> <OBJECTS>"
            CACHE STRING "" FORCE)
endforeach()

set(CMAKE_C_FLAGS_INIT "")
set(CMAKE_CXX_FLAGS_INIT "")
set(CMAKE_C_FLAGS "" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "" CACHE STRING "" FORCE)

foreach (_config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_C_FLAGS_${_config} "" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_${_config} "" CACHE STRING "" FORCE)
endforeach()
set(CMAKE_C_STANDARD_LIBRARIES "" CACHE STRING "" FORCE)
set(CMAKE_CXX_STANDARD_LIBRARIES "" CACHE STRING "" FORCE)
set(CMAKE_MSVC_RUNTIME_LIBRARY "" CACHE STRING "" FORCE)

set(_WDK7_USER_C_OPTIONS
        /nologo /W3 /GS
        /D_STL70_ /D_STATIC_CPPLIB /D_DLL=1 /D_MT=1)
set(_WDK7_USER_CXX_OPTIONS
        /nologo /W3 /GS /EHsc
        /wd4018 /wd4144 /wd4146 /wd4244 /wd4245 /wd4290
        /D_STL70_ /D_STATIC_CPPLIB /D_DLL=1 /D_MT=1)
set(_WDK7_USER_DEBUG_OPTIONS
        /MDd /Zi /Ob0 /Od /DDBG=1 /D_DEBUG)
set(_WDK7_USER_RELEASE_OPTIONS
        /MD /O2 /Ob2 /DNDEBUG)
set(_WDK7_USER_LINK_OPTIONS
        /NODEFAULTLIB:msvcrtd /DEFAULTLIB:msvcrt)
set(_WDK7_USER_DEFAULT_LIBRARIES
        ntstc_msvcrt
        kernel32 user32 gdi32 winspool shell32 ole32 oleaut32 uuid comdlg32 advapi32)

set(_WDK7_KERNEL_C_OPTIONS
        /nologo /W3 /Zl /Gy /GF /GS /Zc:wchar_t-
        ${_WDK7_ARCH_FLAGS} ${_WDK7_ARCH_DEFS}
        /DCONDITION_HANDLING=1 /DNT_INST=0 /DWIN32=100 /D_NT1X_=100 /DWINNT=1
        /D_WIN32_WINNT=0x0601 /DWINVER=0x0601 /D_WIN32_IE=0x0800
        /DNTDDI_VERSION=0x06010000 /DWIN32_LEAN_AND_MEAN=1 /D_KERNEL_MODE=1
        /wd4603 /wd4627)
set(_WDK7_KERNEL_CXX_OPTIONS
        /nologo /W3 /Zl /Gy /GF /GS /GR- /EHs-c- /Zc:wchar_t-
        ${_WDK7_ARCH_FLAGS} ${_WDK7_ARCH_DEFS}
        /DCONDITION_HANDLING=1 /DNT_INST=0 /DWIN32=100 /D_NT1X_=100 /DWINNT=1
        /D_WIN32_WINNT=0x0601 /DWINVER=0x0601 /D_WIN32_IE=0x0800
        /DNTDDI_VERSION=0x06010000 /DWIN32_LEAN_AND_MEAN=1 /D_KERNEL_MODE=1
        /wd4603 /wd4627)
set(_WDK7_KERNEL_DEBUG_OPTIONS
        /Zi /Od /DDBG=1 /DDEVL=1 /D_DEBUG)
set(_WDK7_KERNEL_RELEASE_OPTIONS
        /O2 /Ob2 /DDBG=0 /DDEVL=1 /DNDEBUG)
set(_WDK7_KERNEL_LINK_OPTIONS
        /NODEFAULTLIB
        /MERGE:_PAGE=PAGE
        /MERGE:_TEXT=.text
        /SECTION:INIT,d
        /IGNORE:4198,4010,4037,4039,4065,4070,4078,4087,4089,4221)

function(_wdk7_require_target target)
    if (NOT TARGET "${target}")
        message(FATAL_ERROR "WDK7 target '${target}' does not exist.")
    endif()
endfunction()

function(_wdk7_begin_target_mode target mode out_apply)
    _wdk7_require_target("${target}")
    get_property(_existing TARGET "${target}" PROPERTY WDK7_TARGET_MODE)

    if (_existing)
        if (NOT _existing STREQUAL "${mode}")
            message(FATAL_ERROR
                    "Target '${target}' is already configured as WDK7 ${_existing}; "
                    "cannot reconfigure it as WDK7 ${mode}.")
        endif()
        set(${out_apply} FALSE PARENT_SCOPE)
        return()
    endif()

    set_property(TARGET "${target}" PROPERTY WDK7_TARGET_MODE "${mode}")
    set_property(TARGET "${target}" PROPERTY MSVC_RUNTIME_LIBRARY "")
    set(${out_apply} TRUE PARENT_SCOPE)
endfunction()

function(_wdk7_add_lang_options target lang)
    foreach (_opt IN LISTS ARGN)
        target_compile_options("${target}" PRIVATE
                "$<$<COMPILE_LANGUAGE:${lang}>:${_opt}>")
    endforeach()
endfunction()

function(_wdk7_add_c_cxx_config_options target config)
    foreach (_opt IN LISTS ARGN)
        target_compile_options("${target}" PRIVATE
                "$<$<AND:$<CONFIG:${config}>,$<COMPILE_LANGUAGE:C>>:${_opt}>"
                "$<$<AND:$<CONFIG:${config}>,$<COMPILE_LANGUAGE:CXX>>:${_opt}>")
    endforeach()
endfunction()

function(_wdk7_target_uses_linker target out_uses_linker)
    get_target_property(_type "${target}" TYPE)
    if (_type STREQUAL "EXECUTABLE"
            OR _type STREQUAL "SHARED_LIBRARY"
            OR _type STREQUAL "MODULE_LIBRARY")
        set(${out_uses_linker} TRUE PARENT_SCOPE)
    else()
        set(${out_uses_linker} FALSE PARENT_SCOPE)
    endif()
endfunction()

function(_wdk7_apply_link_options target)
    foreach (_opt IN LISTS ARGN)
        target_link_options("${target}" PRIVATE "${_opt}")
    endforeach()
endfunction()

function(wdk7_target_user target)
    _wdk7_begin_target_mode("${target}" USER _apply)
    if (NOT _apply)
        return()
    endif()

    target_include_directories("${target}" PRIVATE ${WDK7_USER_INCLUDE_DIRS})
    _wdk7_add_lang_options("${target}" C ${_WDK7_USER_C_OPTIONS})
    _wdk7_add_lang_options("${target}" CXX ${_WDK7_USER_CXX_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" Debug ${_WDK7_USER_DEBUG_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" Release ${_WDK7_USER_RELEASE_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" RelWithDebInfo ${_WDK7_USER_RELEASE_OPTIONS} /Zi)
    _wdk7_add_c_cxx_config_options("${target}" MinSizeRel ${_WDK7_USER_RELEASE_OPTIONS})

    _wdk7_target_uses_linker("${target}" _uses_linker)
    if (_uses_linker)
        target_link_directories("${target}" PRIVATE ${WDK7_USER_LIBRARY_DIRS})
        _wdk7_apply_link_options("${target}" ${_WDK7_USER_LINK_OPTIONS})
        target_link_libraries("${target}" PRIVATE ${_WDK7_USER_DEFAULT_LIBRARIES})
    endif()
endfunction()

function(wdk7_target_kernel target)
    _wdk7_begin_target_mode("${target}" KERNEL _apply)
    if (NOT _apply)
        return()
    endif()

    target_include_directories("${target}" PRIVATE ${WDK7_KERNEL_INCLUDE_DIRS})
    _wdk7_add_lang_options("${target}" C ${_WDK7_KERNEL_C_OPTIONS})
    _wdk7_add_lang_options("${target}" CXX ${_WDK7_KERNEL_CXX_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" Debug ${_WDK7_KERNEL_DEBUG_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" Release ${_WDK7_KERNEL_RELEASE_OPTIONS})
    _wdk7_add_c_cxx_config_options("${target}" RelWithDebInfo ${_WDK7_KERNEL_RELEASE_OPTIONS} /Zi)
    _wdk7_add_c_cxx_config_options("${target}" MinSizeRel ${_WDK7_KERNEL_RELEASE_OPTIONS})

    _wdk7_target_uses_linker("${target}" _uses_linker)
    if (_uses_linker)
        target_link_directories("${target}" PRIVATE ${WDK7_KERNEL_LIBRARY_DIRS})
        _wdk7_apply_link_options("${target}" ${_WDK7_KERNEL_LINK_OPTIONS})
    endif()
endfunction()

function(_wdk7_parse_target_mode out_mode out_sources default_mode)
    cmake_parse_arguments(_arg "USER;UM;KERNEL;KM" "" "" ${ARGN})

    if ((_arg_USER OR _arg_UM) AND (_arg_KERNEL OR _arg_KM))
        message(FATAL_ERROR "Specify only one WDK7 target mode: USER/UM or KERNEL/KM.")
    endif()

    set(_mode "${default_mode}")
    if (_arg_KERNEL OR _arg_KM)
        set(_mode KERNEL)
    elseif (_arg_USER OR _arg_UM)
        set(_mode USER)
    endif()

    set(${out_mode} "${_mode}" PARENT_SCOPE)
    set(${out_sources} "${_arg_UNPARSED_ARGUMENTS}" PARENT_SCOPE)
endfunction()

function(_wdk7_apply_target_mode target mode)
    if ("${mode}" STREQUAL "KERNEL")
        wdk7_target_kernel("${target}")
    else()
        wdk7_target_user("${target}")
    endif()
endfunction()

function(_wdk7_split_def out_sources out_def)
    set(_srcs "")
    set(_def "")

    foreach (_src IN LISTS ARGN)
        if (_src MATCHES "\\.def$")
            set(_def "${_src}")
        else()
            list(APPEND _srcs "${_src}")
        endif()
    endforeach()

    set(${out_sources} "${_srcs}" PARENT_SCOPE)
    set(${out_def} "${_def}" PARENT_SCOPE)
endfunction()

function(wdk7_add_exe name)
    cmake_parse_arguments(_arg "GUI;WIN32;USER;UM;KERNEL;KM" "" "" ${ARGN})

    if ((_arg_USER OR _arg_UM) AND (_arg_KERNEL OR _arg_KM))
        message(FATAL_ERROR "Specify only one WDK7 target mode: USER/UM or KERNEL/KM.")
    endif()

    if (_arg_KERNEL OR _arg_KM)
        set(_mode KERNEL)
    else()
        set(_mode USER)
    endif()

    if (_arg_GUI OR _arg_WIN32)
        add_executable(${name} WIN32 ${_arg_UNPARSED_ARGUMENTS})
    else()
        add_executable(${name} ${_arg_UNPARSED_ARGUMENTS})
    endif()
    _wdk7_apply_target_mode("${name}" "${_mode}")
endfunction()

function(wdk7_add_dll name)
    _wdk7_parse_target_mode(_mode _args USER ${ARGN})
    _wdk7_split_def(_srcs _def ${_args})
    add_library(${name} SHARED ${_srcs})
    _wdk7_apply_target_mode("${name}" "${_mode}")

    if (_def)
        get_filename_component(_def_abs "${_def}" ABSOLUTE)
        target_link_options(${name} PRIVATE "/DEF:${_def_abs}")
    endif()
endfunction()

function(wdk7_add_lib name)
    _wdk7_parse_target_mode(_mode _args USER ${ARGN})
    add_library(${name} STATIC ${_args})
    _wdk7_apply_target_mode("${name}" "${_mode}")
endfunction()

function(_wdk7_apply_kmdf_defs target version)
    string(REPLACE "." ";" _parts "${version}")
    list(LENGTH _parts _part_count)
    list(GET _parts 0 _major)
    if (_part_count GREATER 1)
        list(GET _parts 1 _minor)
    else()
        set(_minor 0)
    endif()

    if (_major LESS 10)
        set(_major_str "0${_major}")
    else()
        set(_major_str "${_major}")
    endif()

    if (_minor LESS 10)
        set(_minor_str "00${_minor}")
    elseif (_minor LESS 100)
        set(_minor_str "0${_minor}")
    else()
        set(_minor_str "${_minor}")
    endif()

    target_compile_definitions(${target} PRIVATE
            KMDF_VERSION_MAJOR=${_major}
            KMDF_VERSION_MINOR=${_minor}
            KMDF_MAJOR_VERSION_STRING=${_major_str}
            KMDF_MINOR_VERSION_STRING=${_minor_str})
endfunction()

function(wdk7_add_sys name)
    cmake_parse_arguments(_arg "WDM;KMDF" "KMDF_VERSION" "" ${ARGN})

    if (_arg_WDM AND _arg_KMDF)
        message(FATAL_ERROR "wdk7_add_sys accepts only one driver model: WDM or KMDF.")
    endif()

    if (NOT _arg_KMDF)
        set(_arg_WDM TRUE)
    endif()

    if (NOT _arg_KMDF_VERSION)
        set(_arg_KMDF_VERSION "1.9")
    endif()

    add_executable(${name} ${_arg_UNPARSED_ARGUMENTS})
    set_target_properties(${name} PROPERTIES SUFFIX ".sys")
    wdk7_target_kernel("${name}")

    if (_arg_KMDF)
        if (WDK7_ARCH STREQUAL "i386")
            set(_entry "FxDriverEntry@8")
        else()
            set(_entry "FxDriverEntry")
        endif()

        set(_kmdf_inc "${WDK7_ROOT}/inc/wdf/kmdf/${_arg_KMDF_VERSION}")
        set(_kmdf_lib "${WDK7_ROOT}/lib/wdf/kmdf/${_WDK7_LIB}/${_arg_KMDF_VERSION}")
        if (NOT EXISTS "${_kmdf_inc}/wdf.h" OR NOT EXISTS "${_kmdf_lib}/WdfDriverEntry.lib")
            message(FATAL_ERROR "KMDF ${_arg_KMDF_VERSION} not found under '${WDK7_ROOT}'.")
        endif()

        target_include_directories(${name} PRIVATE "${_kmdf_inc}")
        target_link_directories(${name} PRIVATE "${_kmdf_lib}")
        _wdk7_apply_kmdf_defs(${name} "${_arg_KMDF_VERSION}")
        target_link_libraries(${name} PRIVATE
                ntoskrnl hal wmilib BufferOverflowK WdfLdr WdfDriverEntry)
    else()
        if (WDK7_ARCH STREQUAL "i386")
            set(_entry "GsDriverEntry@8")
        else()
            set(_entry "GsDriverEntry")
        endif()
        target_link_libraries(${name} PRIVATE
                ntoskrnl hal wmilib BufferOverflowK)
    endif()

    target_link_options(${name} PRIVATE
            /DRIVER
            /SUBSYSTEM:NATIVE
            "/ENTRY:${_entry}")
endfunction()

message(STATUS "[WDK7] ROOT='${WDK7_ROOT}' ARCH='${WDK7_ARCH}' BIN='${WDK7_BIN}'")
message(STATUS "[WDK7] USER_INCLUDE_DIRS='${WDK7_USER_INCLUDE_DIRS}'")
message(STATUS "[WDK7] KERNEL_INCLUDE_DIRS='${WDK7_KERNEL_INCLUDE_DIRS}'")
