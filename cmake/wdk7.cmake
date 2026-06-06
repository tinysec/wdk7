# WDK7-only CMake toolchain.
#
# WDK7 CMake toolchain version: v1.0.1.
# Canonical source:
# https://github.com/tinysec/setup-wdk7/blob/master/cmake/wdk7.cmake
# Downstream repositories may copy this file, but must not modify their local
# copies. Update downstream copies only by syncing from the canonical source.
#
# Usage:
#   cmake -S . -B build-wdk7 -G "NMake Makefiles" ^
#     -DCMAKE_TOOLCHAIN_FILE=cmake/wdk7.cmake ^
#     -DWDK7_ARCH=amd64
#
# This file intentionally supports only Windows Driver Kit 7.1
# (7600.16385.1). It adapts WDK7 to ordinary CMake targets: user-mode projects
# can keep using add_executable(), add_library(), target_link_libraries(), and
# target_link_options() without WDK7-specific helper commands.

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
set(CMAKE_C_COMPILER_VERSION         "15.0.30729.207")
set(CMAKE_CXX_COMPILER_VERSION       "15.0.30729.207")
set(CMAKE_C_SIMULATE_VERSION         "15.0.30729.207")
set(CMAKE_CXX_SIMULATE_VERSION       "15.0.30729.207")
set(MSVC_VERSION                     1500 CACHE INTERNAL "")
set(MSVC_TOOLSET_VERSION             90 CACHE INTERNAL "")
set(MSVC90                           TRUE CACHE INTERNAL "")

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
set(WDK7_DEFAULT_MODE "USER" CACHE STRING "Default WDK7 mode for ordinary CMake targets: USER, KERNEL, or NONE")
set_property(CACHE WDK7_DEFAULT_MODE PROPERTY STRINGS USER KERNEL NONE)

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

# Joins list values into the space-delimited flag strings expected by the WDK7
# MSVC-compatible command line. CMake lists are easier to maintain above, while
# the compiler and linker still need plain command-line text.
function(_wdk7_join out_var)
    # The result is returned through PARENT_SCOPE so callers can keep all
    # intermediate flag names local to the toolchain file.
    string(REPLACE ";" " " _joined "${ARGN}")
    set(${out_var} "${_joined}" PARENT_SCOPE)
endfunction()

# Converts library directories to explicit /LIBPATH flags. WDK7 link behavior is
# more predictable when the exact library search order is passed to link.exe.
function(_wdk7_link_directories_flags out_var)
    set(_flags "")

    # The explicit loop keeps each directory visible in generated cache values
    # and avoids hiding path order in a compact expression.
    foreach (_dir IN LISTS ARGN)
        list(APPEND _flags "/LIBPATH:${_dir}")
    endforeach()

    set(${out_var} "${_flags}" PARENT_SCOPE)
endfunction()

string(TOUPPER "${WDK7_DEFAULT_MODE}" WDK7_DEFAULT_MODE)
if (NOT WDK7_DEFAULT_MODE STREQUAL "USER"
        AND NOT WDK7_DEFAULT_MODE STREQUAL "KERNEL"
        AND NOT WDK7_DEFAULT_MODE STREQUAL "NONE")
    message(FATAL_ERROR "WDK7_DEFAULT_MODE must be USER, KERNEL, or NONE.")
endif()

if (WDK7_DEFAULT_MODE STREQUAL "USER")
    _wdk7_join(_WDK7_USER_C_FLAGS ${_WDK7_USER_C_OPTIONS})
    _wdk7_join(_WDK7_USER_CXX_FLAGS ${_WDK7_USER_CXX_OPTIONS})
    _wdk7_join(_WDK7_USER_DEBUG_FLAGS ${_WDK7_USER_DEBUG_OPTIONS})
    _wdk7_join(_WDK7_USER_RELEASE_FLAGS ${_WDK7_USER_RELEASE_OPTIONS})
    _wdk7_join(_WDK7_USER_LINK_FLAGS ${_WDK7_USER_LINK_OPTIONS})
    _wdk7_link_directories_flags(_WDK7_USER_LIBRARY_FLAGS ${WDK7_USER_LIBRARY_DIRS})
    set(_WDK7_USER_DEFAULT_STANDARD_LIBRARIES "")
    foreach (_lib IN LISTS _WDK7_USER_DEFAULT_LIBRARIES)
        list(APPEND _WDK7_USER_DEFAULT_STANDARD_LIBRARIES "${_lib}.lib")
    endforeach()
    _wdk7_join(_WDK7_USER_STANDARD_LIBRARIES
            ${_WDK7_USER_LIBRARY_FLAGS}
            ${_WDK7_USER_DEFAULT_STANDARD_LIBRARIES})

    set(CMAKE_C_STANDARD_INCLUDE_DIRECTORIES "${WDK7_USER_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_STANDARD_INCLUDE_DIRECTORIES "${WDK7_USER_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_RC_STANDARD_INCLUDE_DIRECTORIES "${WDK7_USER_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS "${_WDK7_USER_C_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS "${_WDK7_USER_CXX_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_DEBUG "${_WDK7_USER_DEBUG_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_DEBUG "${_WDK7_USER_DEBUG_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_RELEASE "${_WDK7_USER_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_RELEASE "${_WDK7_USER_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_RELWITHDEBINFO "${_WDK7_USER_RELEASE_FLAGS} /Zi" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${_WDK7_USER_RELEASE_FLAGS} /Zi" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_MINSIZEREL "${_WDK7_USER_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_MINSIZEREL "${_WDK7_USER_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_STANDARD_LIBRARIES "${_WDK7_USER_STANDARD_LIBRARIES}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_STANDARD_LIBRARIES "${_WDK7_USER_STANDARD_LIBRARIES}" CACHE STRING "" FORCE)
    set(CMAKE_EXE_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_USER_LINK_FLAGS}"
            CACHE STRING "" FORCE)
    set(CMAKE_SHARED_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_USER_LINK_FLAGS}"
            CACHE STRING "" FORCE)
    set(CMAKE_MODULE_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_USER_LINK_FLAGS}"
            CACHE STRING "" FORCE)
elseif (WDK7_DEFAULT_MODE STREQUAL "KERNEL")
    _wdk7_join(_WDK7_KERNEL_C_FLAGS ${_WDK7_KERNEL_C_OPTIONS})
    _wdk7_join(_WDK7_KERNEL_CXX_FLAGS ${_WDK7_KERNEL_CXX_OPTIONS})
    _wdk7_join(_WDK7_KERNEL_DEBUG_FLAGS ${_WDK7_KERNEL_DEBUG_OPTIONS})
    _wdk7_join(_WDK7_KERNEL_RELEASE_FLAGS ${_WDK7_KERNEL_RELEASE_OPTIONS})
    _wdk7_join(_WDK7_KERNEL_LINK_FLAGS ${_WDK7_KERNEL_LINK_OPTIONS})
    _wdk7_link_directories_flags(_WDK7_KERNEL_LIBRARY_FLAGS ${WDK7_KERNEL_LIBRARY_DIRS})
    _wdk7_join(_WDK7_KERNEL_STANDARD_LIBRARIES ${_WDK7_KERNEL_LIBRARY_FLAGS})

    set(CMAKE_C_STANDARD_INCLUDE_DIRECTORIES "${WDK7_KERNEL_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_STANDARD_INCLUDE_DIRECTORIES "${WDK7_KERNEL_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_RC_STANDARD_INCLUDE_DIRECTORIES "${WDK7_KERNEL_INCLUDE_DIRS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS "${_WDK7_KERNEL_C_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS "${_WDK7_KERNEL_CXX_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_DEBUG "${_WDK7_KERNEL_DEBUG_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_DEBUG "${_WDK7_KERNEL_DEBUG_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_RELEASE "${_WDK7_KERNEL_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_RELEASE "${_WDK7_KERNEL_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_RELWITHDEBINFO "${_WDK7_KERNEL_RELEASE_FLAGS} /Zi" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "${_WDK7_KERNEL_RELEASE_FLAGS} /Zi" CACHE STRING "" FORCE)
    set(CMAKE_C_FLAGS_MINSIZEREL "${_WDK7_KERNEL_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_FLAGS_MINSIZEREL "${_WDK7_KERNEL_RELEASE_FLAGS}" CACHE STRING "" FORCE)
    set(CMAKE_C_STANDARD_LIBRARIES "${_WDK7_KERNEL_STANDARD_LIBRARIES}" CACHE STRING "" FORCE)
    set(CMAKE_CXX_STANDARD_LIBRARIES "${_WDK7_KERNEL_STANDARD_LIBRARIES}" CACHE STRING "" FORCE)
    set(CMAKE_EXE_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_KERNEL_LINK_FLAGS}"
            CACHE STRING "" FORCE)
    set(CMAKE_SHARED_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_KERNEL_LINK_FLAGS}"
            CACHE STRING "" FORCE)
    set(CMAKE_MODULE_LINKER_FLAGS
            "/nologo /INCREMENTAL:NO /MANIFEST:NO ${_WDK7_KERNEL_LINK_FLAGS}"
            CACHE STRING "" FORCE)
endif()

# Adds language-specific compile options to an imported interface target. This
# lets mixed C/C++ consumers inherit only the options that apply to each source
# language.
function(_wdk7_interface_lang_options target lang)
    # Generator expressions are kept at this boundary so project CMake files can
    # stay ordinary add_executable/add_library definitions.
    foreach (_opt IN LISTS ARGN)
        set_property(TARGET "${target}" APPEND PROPERTY INTERFACE_COMPILE_OPTIONS
                "$<$<COMPILE_LANGUAGE:${lang}>:${_opt}>")
    endforeach()
endfunction()

# Adds configuration-specific options for both C and C++ sources. Debug and
# release flags differ under WDK7, and consumers should inherit the correct set
# without repeating toolchain details in project files.
function(_wdk7_interface_c_cxx_config_options target config)
    # Both language branches are added together so Debug/Release behavior stays
    # symmetric for mixed-language targets.
    foreach (_opt IN LISTS ARGN)
        set_property(TARGET "${target}" APPEND PROPERTY INTERFACE_COMPILE_OPTIONS
                "$<$<AND:$<CONFIG:${config}>,$<COMPILE_LANGUAGE:C>>:${_opt}>"
                "$<$<AND:$<CONFIG:${config}>,$<COMPILE_LANGUAGE:CXX>>:${_opt}>")
    endforeach()
endfunction()

if (NOT TARGET WDK7::User)
    add_library(WDK7::User INTERFACE IMPORTED GLOBAL)
    set_property(TARGET WDK7::User PROPERTY
            INTERFACE_INCLUDE_DIRECTORIES "${WDK7_USER_INCLUDE_DIRS}")
    set_property(TARGET WDK7::User PROPERTY
            INTERFACE_LINK_DIRECTORIES "${WDK7_USER_LIBRARY_DIRS}")
    set_property(TARGET WDK7::User PROPERTY
            INTERFACE_LINK_OPTIONS "${_WDK7_USER_LINK_OPTIONS}")
    set_property(TARGET WDK7::User PROPERTY
            INTERFACE_LINK_LIBRARIES "${_WDK7_USER_DEFAULT_LIBRARIES}")

    _wdk7_interface_lang_options(WDK7::User C ${_WDK7_USER_C_OPTIONS})
    _wdk7_interface_lang_options(WDK7::User CXX ${_WDK7_USER_CXX_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::User Debug ${_WDK7_USER_DEBUG_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::User Release ${_WDK7_USER_RELEASE_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::User RelWithDebInfo ${_WDK7_USER_RELEASE_OPTIONS} /Zi)
    _wdk7_interface_c_cxx_config_options(WDK7::User MinSizeRel ${_WDK7_USER_RELEASE_OPTIONS})
endif()

if (NOT TARGET WDK7::Kernel)
    add_library(WDK7::Kernel INTERFACE IMPORTED GLOBAL)
    set_property(TARGET WDK7::Kernel PROPERTY
            INTERFACE_INCLUDE_DIRECTORIES "${WDK7_KERNEL_INCLUDE_DIRS}")
    set_property(TARGET WDK7::Kernel PROPERTY
            INTERFACE_LINK_DIRECTORIES "${WDK7_KERNEL_LIBRARY_DIRS}")
    set_property(TARGET WDK7::Kernel PROPERTY
            INTERFACE_LINK_OPTIONS "${_WDK7_KERNEL_LINK_OPTIONS}")

    _wdk7_interface_lang_options(WDK7::Kernel C ${_WDK7_KERNEL_C_OPTIONS})
    _wdk7_interface_lang_options(WDK7::Kernel CXX ${_WDK7_KERNEL_CXX_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::Kernel Debug ${_WDK7_KERNEL_DEBUG_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::Kernel Release ${_WDK7_KERNEL_RELEASE_OPTIONS})
    _wdk7_interface_c_cxx_config_options(WDK7::Kernel RelWithDebInfo ${_WDK7_KERNEL_RELEASE_OPTIONS} /Zi)
    _wdk7_interface_c_cxx_config_options(WDK7::Kernel MinSizeRel ${_WDK7_KERNEL_RELEASE_OPTIONS})
endif()

if (NOT TARGET WDK7::KernelWdm)
    add_library(WDK7::KernelWdm INTERFACE IMPORTED GLOBAL)
    set_property(TARGET WDK7::KernelWdm PROPERTY
            INTERFACE_LINK_LIBRARIES "WDK7::Kernel;ntoskrnl;hal;wmilib;BufferOverflowK")
endif()

message(STATUS "[WDK7] ROOT='${WDK7_ROOT}' ARCH='${WDK7_ARCH}' BIN='${WDK7_BIN}'")
message(STATUS "[WDK7] USER_INCLUDE_DIRS='${WDK7_USER_INCLUDE_DIRS}'")
message(STATUS "[WDK7] KERNEL_INCLUDE_DIRS='${WDK7_KERNEL_INCLUDE_DIRS}'")
