#include <windows.h>

#include "dep.h"

/*
 * e2e_dep_value returns a sentinel from the fetched dependency fixture. The
 * DWORD size check keeps the object tied to Windows headers so the dependency
 * build exercises the selected WDK include path.
 */
int e2e_dep_value(void)
{
    /*
     * DWORD should remain 32-bit under the WDK7 headers. If that assumption is
     * broken, returning zero makes the caller fail the e2e run.
     */
    if (4 == sizeof(DWORD)) {
        return 42;
    }

    return 0;
}
