include_guard(GLOBAL)

function(_DbgEng_target_arch out_var)
    if (DEFINED WDK7_ARCH)
        if (WDK7_ARCH STREQUAL "amd64" OR WDK7_ARCH STREQUAL "x64")
            set(${out_var} "x64" PARENT_SCOPE)
            return()
        elseif (WDK7_ARCH STREQUAL "i386" OR WDK7_ARCH STREQUAL "x86")
            set(${out_var} "x86" PARENT_SCOPE)
            return()
        endif()
    endif()

    if (CMAKE_GENERATOR_PLATFORM MATCHES "^(x64|amd64)$")
        set(${out_var} "x64" PARENT_SCOPE)
    elseif (CMAKE_GENERATOR_PLATFORM MATCHES "^(Win32|x86)$")
        set(${out_var} "x86" PARENT_SCOPE)
    elseif (CMAKE_SIZEOF_VOID_P EQUAL 8)
        set(${out_var} "x64" PARENT_SCOPE)
    elseif (CMAKE_SIZEOF_VOID_P EQUAL 4)
        set(${out_var} "x86" PARENT_SCOPE)
    else()
        message(FATAL_ERROR "DbgEng SDK target architecture is unknown. Use a Win32/x64 generator platform.")
    endif()
endfunction()

function(_DbgEng_pick_kits_version root arch out_var)
    file(GLOB _versions RELATIVE "${root}/Include" "${root}/Include/*")
    set(_best "")

    foreach (_ver IN LISTS _versions)
        if (EXISTS "${root}/Include/${_ver}/um/DbgEng.h"
                AND EXISTS "${root}/Lib/${_ver}/um/${arch}/DbgEng.Lib")
            if (_best STREQUAL "" OR _ver STRGREATER _best)
                set(_best "${_ver}")
            endif()
        endif()
    endforeach()

    set(${out_var} "${_best}" PARENT_SCOPE)
endfunction()

function(_DbgEng_set_result include_dirs library_dir source)
    list(GET include_dirs 0 _primary_include_dir)

    set(DbgEng_INCLUDE_DIR "${_primary_include_dir}" CACHE PATH "DbgEng include directory" FORCE)
    set(DbgEng_INCLUDE_DIRS "${include_dirs}" CACHE STRING "DbgEng include directories" FORCE)
    set(DbgEng_LIBRARY_DIR "${library_dir}" CACHE PATH "DbgEng library directory" FORCE)
    set(DbgEng_LIBRARIES dbgeng dbghelp CACHE STRING "DbgEng libraries" FORCE)
    set(_DbgEng_SOURCE "${source}" PARENT_SCOPE)
endfunction()

_DbgEng_target_arch(_DbgEng_ARCH)
set(DbgEng_ARCH "${_DbgEng_ARCH}" CACHE STRING "DbgEng target architecture" FORCE)

if (_DbgEng_ARCH STREQUAL "x64")
    set(_DbgEng_ACTION_LIB "$ENV{WDK7_DBGENG_LIB_AMD64}")
    set(_DbgEng_ACTION_WDK7_ARCH "amd64")
else()
    set(_DbgEng_ACTION_LIB "$ENV{WDK7_DBGENG_LIB_I386}")
    set(_DbgEng_ACTION_WDK7_ARCH "i386")
endif()

if (DEFINED ENV{WDK7_DBGENG_INCLUDE_DIR}
        AND NOT "$ENV{WDK7_DBGENG_INCLUDE_DIR}" STREQUAL ""
        AND NOT "${_DbgEng_ACTION_LIB}" STREQUAL "")
    set(_inc "$ENV{WDK7_DBGENG_INCLUDE_DIR}")
    set(_lib "${_DbgEng_ACTION_LIB}")
    if (EXISTS "${_inc}/DbgEng.h"
            AND EXISTS "${_lib}/dbgeng.lib"
            AND EXISTS "${_lib}/dbghelp.lib")
        _DbgEng_set_result("${_inc}" "${_lib}" "wdk7 action")
    endif()
endif()

if (NOT DbgEng_LIBRARY_DIR
        AND DEFINED ENV{WDK7_DEBUGGERS_ROOT}
        AND NOT "$ENV{WDK7_DEBUGGERS_ROOT}" STREQUAL "")
    set(_dbg_root "$ENV{WDK7_DEBUGGERS_ROOT}")

    set(_inc "${_dbg_root}/sdk/inc")
    set(_lib "${_dbg_root}/sdk/lib/${_DbgEng_ACTION_WDK7_ARCH}")
    if (EXISTS "${_inc}/DbgEng.h"
            AND EXISTS "${_lib}/dbgeng.lib"
            AND EXISTS "${_lib}/dbghelp.lib")
        _DbgEng_set_result("${_inc}" "${_lib}" "wdk7 action Debuggers SDK")
    endif()

    if (NOT DbgEng_LIBRARY_DIR)
        set(_inc "${_dbg_root}/inc")
        set(_lib "${_dbg_root}/lib/${_DbgEng_ARCH}")
        if (EXISTS "${_inc}/DbgEng.h"
                AND EXISTS "${_lib}/dbgeng.lib"
                AND EXISTS "${_lib}/dbghelp.lib")
            _DbgEng_set_result("${_inc}" "${_lib}" "wdk7 action Debuggers SDK")
        endif()
    endif()
endif()

if (WDK7)
    if (_DbgEng_ARCH STREQUAL "x64")
        set(_DbgEng_WDK7_ARCH "amd64")
        set(_DbgEng_SDK_LIB_ARCH "x64")
    else()
        set(_DbgEng_WDK7_ARCH "i386")
        set(_DbgEng_SDK_LIB_ARCH "")
    endif()

    set(_inc "${WDK7_ROOT}/Debuggers/sdk/inc")
    set(_lib "${WDK7_ROOT}/Debuggers/sdk/lib/${_DbgEng_WDK7_ARCH}")
    if (EXISTS "${_inc}/DbgEng.h" AND EXISTS "${_lib}/dbgeng.lib")
        _DbgEng_set_result("${_inc}" "${_lib}" "WDK7 SDK")
    endif()

    if (NOT DbgEng_LIBRARY_DIR)
        set(_sdk_roots
                "C:/Program Files (x86)/Microsoft SDKs/Windows/v7.1A"
                "C:/Program Files/Microsoft SDKs/Windows/v6.0A")
        foreach (_sdk_root IN LISTS _sdk_roots)
            set(_inc "${_sdk_root}/Include")
            if (_DbgEng_SDK_LIB_ARCH)
                set(_lib "${_sdk_root}/Lib/${_DbgEng_SDK_LIB_ARCH}")
            else()
                set(_lib "${_sdk_root}/Lib")
            endif()

            if (EXISTS "${_inc}/DbgEng.h" AND EXISTS "${_lib}/DbgEng.Lib")
                _DbgEng_set_result("${_inc}" "${_lib}" "Windows SDK for WDK7")
                break()
            endif()
        endforeach()
    endif()

    if (NOT DbgEng_LIBRARY_DIR)
        set(_kits_roots
                "C:/Program Files (x86)/Windows Kits/11"
                "C:/Program Files/Windows Kits/11"
                "C:/Program Files (x86)/Windows Kits/10"
                "C:/Program Files/Windows Kits/10")

        foreach (_root IN LISTS _kits_roots)
            file(TO_CMAKE_PATH "${_root}" _root)
            string(REGEX REPLACE "/$" "" _root "${_root}")

            if (EXISTS "${_root}/Debuggers/inc/DbgEng.h"
                    AND EXISTS "${_root}/Debuggers/lib/${_DbgEng_ARCH}/dbgeng.lib")
                set(_inc "${_root}/Debuggers/inc")
                set(_lib "${_root}/Debuggers/lib/${_DbgEng_ARCH}")
                _DbgEng_set_result("${_inc}" "${_lib}" "Debuggers SDK")
                break()
            endif()

            if (EXISTS "${_root}/Include" AND EXISTS "${_root}/Lib")
                _DbgEng_pick_kits_version("${_root}" "${_DbgEng_ARCH}" _kits_ver)
                if (_kits_ver)
                    set(_inc "${_root}/Include/${_kits_ver}/um;${_root}/Include/${_kits_ver}/shared")
                    set(_lib "${_root}/Lib/${_kits_ver}/um/${_DbgEng_ARCH}")
                    _DbgEng_set_result("${_inc}" "${_lib}" "Windows SDK ${_kits_ver}")
                    break()
                endif()
            endif()
        endforeach()
    endif()
else()
    set(_roots "")
    if (DEFINED DbgEng_ROOT)
        list(APPEND _roots "${DbgEng_ROOT}")
    endif()
    if (DEFINED DBGENG_SDK_ROOT)
        list(APPEND _roots "${DBGENG_SDK_ROOT}")
    endif()
    if (DEFINED ENV{DbgEng_ROOT})
        list(APPEND _roots "$ENV{DbgEng_ROOT}")
    endif()
    if (DEFINED ENV{DBGENG_SDK_ROOT})
        list(APPEND _roots "$ENV{DBGENG_SDK_ROOT}")
    endif()
    if (DEFINED ENV{WindowsSdkDir})
        list(APPEND _roots "$ENV{WindowsSdkDir}")
    endif()
    list(APPEND _roots
            "C:/Program Files (x86)/Windows Kits/11"
            "C:/Program Files/Windows Kits/11"
            "C:/Program Files (x86)/Windows Kits/10"
            "C:/Program Files/Windows Kits/10")

    foreach (_root IN LISTS _roots)
        file(TO_CMAKE_PATH "${_root}" _root)
        string(REGEX REPLACE "/$" "" _root "${_root}")

        if (EXISTS "${_root}/Debuggers/inc/DbgEng.h"
                AND EXISTS "${_root}/Debuggers/lib/${_DbgEng_ARCH}/dbgeng.lib")
            set(_inc "${_root}/Debuggers/inc")
            set(_lib "${_root}/Debuggers/lib/${_DbgEng_ARCH}")
            _DbgEng_set_result("${_inc}" "${_lib}" "Debuggers SDK")
            break()
        endif()

        if (EXISTS "${_root}/Include" AND EXISTS "${_root}/Lib")
            _DbgEng_pick_kits_version("${_root}" "${_DbgEng_ARCH}" _kits_ver)
            if (_kits_ver)
                set(_inc "${_root}/Include/${_kits_ver}/um;${_root}/Include/${_kits_ver}/shared")
                set(_lib "${_root}/Lib/${_kits_ver}/um/${_DbgEng_ARCH}")
                _DbgEng_set_result("${_inc}" "${_lib}" "Windows SDK ${_kits_ver}")
                break()
            endif()
        endif()
    endforeach()
endif()

include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(DbgEng
        REQUIRED_VARS DbgEng_INCLUDE_DIR DbgEng_LIBRARY_DIR)

if (DbgEng_FOUND)
    if (NOT TARGET DbgEng::DbgEng)
        add_library(DbgEng::DbgEng INTERFACE IMPORTED GLOBAL)
    endif()

    set_property(TARGET DbgEng::DbgEng PROPERTY
            INTERFACE_INCLUDE_DIRECTORIES "${DbgEng_INCLUDE_DIRS}")
    set_property(TARGET DbgEng::DbgEng PROPERTY
            INTERFACE_LINK_DIRECTORIES "${DbgEng_LIBRARY_DIR}")
    set_property(TARGET DbgEng::DbgEng PROPERTY
            INTERFACE_LINK_LIBRARIES "${DbgEng_LIBRARIES}")

    message(STATUS "[DbgEng] ${_DbgEng_SOURCE}: include='${DbgEng_INCLUDE_DIRS}' lib='${DbgEng_LIBRARY_DIR}'")
endif()

mark_as_advanced(DbgEng_INCLUDE_DIR DbgEng_INCLUDE_DIRS DbgEng_LIBRARY_DIR DbgEng_LIBRARIES DbgEng_ARCH)
