// What bindgen reads for p11's module, as p08's: the SDK's Windows types for a
// module, which give HANDLE 64 bits, then SimConnect.h, which uses them without
// including them, and the Vars API.
#include <MSFS/MSFS_WindowsTypes.h>
#include <SimConnect.h>
#include <MSFS/MSFS_Vars.h>
