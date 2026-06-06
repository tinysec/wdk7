#include <ntddk.h>

/*
 * DriverEntry is the required entry point for the CMake kernel-mode fixture.
 * The driver performs no runtime work because CI only needs to validate the WDK7
 * compiler, linker flags, and .sys output.
 */
NTSTATUS DriverEntry(PDRIVER_OBJECT driver_object, PUNICODE_STRING registry_path)
{
    /*
     * The WDK entry signature requires these parameters even though this fixture
     * does not create devices or read registry configuration.
     */
    UNREFERENCED_PARAMETER(driver_object);
    UNREFERENCED_PARAMETER(registry_path);

    return STATUS_SUCCESS;
}
