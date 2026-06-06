#include <windows.h>

#include "dep.h"

int e2e_dep_value(void)
{
    return sizeof(DWORD) == 4 ? 42 : 0;
}
