#include "dep.h"

/*
 * main verifies that a target can link against the FetchContent dependency
 * built by the same WDK7 CMake toolchain.
 */
int main(void)
{
    /*
     * The dependency returns a sentinel value, which proves the fixture linked
     * the generated static library instead of only compiling this source file.
     */
    if (42 == e2e_dep_value()) {
        return 0;
    }

    return 1;
}
