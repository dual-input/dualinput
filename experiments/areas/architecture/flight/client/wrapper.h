// What bindgen reads for p08's client. SimConnect.h uses Windows' types without
// including windows.h, so a program includes windows.h first, as the SDK's
// samples do.
#include <windows.h>
#include "SimConnect.h"
