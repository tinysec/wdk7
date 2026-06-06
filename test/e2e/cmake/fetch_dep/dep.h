#ifndef __E2E_FETCH_DEP_HEADER_FILE__
#define __E2E_FETCH_DEP_HEADER_FILE__

/*
 * e2e_dep_value exposes the fetched dependency sentinel to the native fixture.
 * Keeping the declaration in a header makes the link dependency explicit.
 */
int e2e_dep_value(void);

#endif
