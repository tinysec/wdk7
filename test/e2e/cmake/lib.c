/*
 * e2e_add gives the static-library fixture a callable symbol. The body is
 * intentionally simple because the test is about archive creation, not math.
 */
int e2e_add(int left, int right)
{
    /*
     * Returning the sum keeps the object file useful without introducing any
     * platform-specific runtime dependency.
     */
    return left + right;
}
