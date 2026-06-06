#include <ntddk.h>

/*
 * DriverEntry is the required entry point for the ddkbuild compatibility
 * fixture. The driver stays inert so the test isolates wrapper/toolchain
 * behavior from driver runtime behavior.
 */
NTSTATUS DriverEntry(PDRIVER_OBJECT driver_object, PUNICODE_STRING registry_path)
{
    /*
     * The parameters are part of the kernel entry contract, but this fixture has
     * no device or registry setup to perform.
     */
    UNREFERENCED_PARAMETER(driver_object);
    UNREFERENCED_PARAMETER(registry_path);

    return STATUS_SUCCESS;
}
