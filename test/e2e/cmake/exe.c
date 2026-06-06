#include <windows.h>

/*
 * main is a minimal user-mode fixture entry point. The test only needs to prove
 * that WDK7 can compile and link an executable through the CMake toolchain.
 */
int main(void)
{
    /*
     * Returning success keeps the fixture focused on toolchain behavior rather
     * than runtime behavior.
     */
    return 0;
}
