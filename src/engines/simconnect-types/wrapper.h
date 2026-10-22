// SimConnect.h uses Windows' types, such as DWORD, without including windows.h, so a
// program includes windows.h first, as the SDK's samples do, and so does what bindgen reads.
#include <windows.h>
#include "SimConnect.h"
