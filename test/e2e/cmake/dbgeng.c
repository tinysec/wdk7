#include <dbgeng.h>

/*
 * main references an SDK type from dbgeng.h. The fixture validates include and
 * library discovery without creating a debugger client at runtime.
 */
int main(void)
{
    IDebugClient *client = 0;

    /*
     * The pointer intentionally stays null. The compile/link step is the signal
     * under test, and creating a real debugger client would add CI-only runtime
     * requirements.
     */
    if (0 != client) {
        return 1;
    }

    return 0;
}
