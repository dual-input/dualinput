// What bindgen reads for our module. SimConnect.h uses Windows' types without including
// them, so the SDK's own types for a module come first, which give HANDLE 64 bits. Then
// SimConnect, the Vars API, and the Events API, which brings the key events' numbers from
// Types/MSFS_EventsEnum.h.
#include <MSFS/MSFS_WindowsTypes.h>
#include <SimConnect.h>
#include <MSFS/MSFS_Vars.h>
#include <MSFS/MSFS_Events.h>
