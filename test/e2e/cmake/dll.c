#include <windows.h>

/*
 * DllMain is the minimal DLL entry point required by the linker. The fixture
 * intentionally ignores loader events because CI only validates that WDK7 can
 * produce a DLL.
 */
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved)
{
    /*
     * These parameters are required by the Windows loader contract but unused in
     * this compile/link fixture.
     */
    UNREFERENCED_PARAMETER(instance);
    UNREFERENCED_PARAMETER(reason);
    UNREFERENCED_PARAMETER(reserved);

    return TRUE;
}

/*
 * e2e_answer gives the DLL a simple exported symbol. An export verifies that the
 * produced binary is more than an empty loader stub.
 */
__declspec(dllexport) int e2e_answer(void)
{
    /*
     * A stable literal is enough for link/export validation and avoids pulling
     * any runtime dependency into the fixture.
     */
    return 7;
}
