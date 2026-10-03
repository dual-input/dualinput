/*
 * crosscheck-p12-follow: writes one AI object's position every frame from
 * inside the sim, for experiments/areas/avatars/p12-wasm.mjs.
 *
 * Writes from outside the sim stuttered against a moving cockpit
 * (record/areas/avatars/log.md, 2026-10-03). Update_StandAlone runs after the
 * sim's update and before model behaviors, an Asobo developer wrote
 * (devsupport.flightsimulator.com/t/15196), so a write here sees this frame's
 * aircraft pose before the frame is drawn.
 *
 * The probe drives it through L: variables, all CROSSCHECK_P12_:
 *
 *   MODE     0 off, 1 fsVarsAVarSet on the object, 2 SimConnect_SetDataOnSimObject
 *   OBJECT   the object's SimConnect ID
 *   FWD, RIGHT, UP   where to put it, in meters from the aircraft's
 *                    reference point; turned by heading only
 *
 * and it reports back through ALIVE (every frame), FRAMES (every frame it
 * wrote), ERRORS, and LAST_ERROR (an FsVarError, or 1000 + a SimConnect
 * exception).
 */

#include <MSFS/MSFS.h>
// DWORD and HANDLE, which SimConnect.h assumes (fsc-editor, link/src/module.cpp).
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Vars.h>
#include <SimConnect.h>
#include <cmath>

namespace
{
const double PI      = 3.14159265358979323846;
const double RAD     = PI / 180.0;
const double EARTH_M = 6371000.0;
const double FT      = 0.3048;

const SIMCONNECT_DATA_DEFINITION_ID DEF_POS = 1;

struct Pos
{
    double lat, lon, alt, hdg;
};

HANDLE h_sim = 0;

FsUnitId u_number, u_degrees, u_feet;
FsAVarId a_lat, a_lon, a_alt, a_hdg;
FsLVarId l_alive, l_mode, l_object, l_fwd, l_right, l_up, l_frames, l_errors, l_last_error;

double get(FsLVarId id)
{
    double v = 0;
    (void)fsVarsLVarGet(id, u_number, &v);
    return v;
}

void put(FsLVarId id, double v) { (void)fsVarsLVarSet(id, u_number, v); }

void fail(double code)
{
    put(l_errors, get(l_errors) + 1);
    put(l_last_error, code);
}

// SimConnect reports a rejected write as an exception on the next dispatch,
// not as a failed call.
void CALLBACK on_dispatch(SIMCONNECT_RECV* data, DWORD, void*)
{
    if (data->dwID == SIMCONNECT_RECV_ID_EXCEPTION)
        fail(1000.0 + static_cast<SIMCONNECT_RECV_EXCEPTION*>(data)->dwException);
}

bool read_aircraft(Pos& a)
{
    FsVarParamArray none;
    return fsVarsAVarGet(a_lat, u_degrees, none, &a.lat, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_lon, u_degrees, none, &a.lon, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_alt, u_feet, none, &a.alt, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_hdg, u_degrees, none, &a.hdg, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE;
}

// The same turn as experiments/areas/avatars/lib/pose.mjs, toWorld.
Pos place(const Pos& a, double fwd, double right, double up)
{
    const double h     = a.hdg * RAD;
    const double north = fwd * std::cos(h) - right * std::sin(h);
    const double east  = fwd * std::sin(h) + right * std::cos(h);
    return Pos{a.lat + (north / EARTH_M) / RAD, a.lon + (east / (EARTH_M * std::cos(a.lat * RAD))) / RAD,
               a.alt + up / FT, a.hdg};
}
} // namespace

extern "C" MSFS_CALLBACK void module_init(void)
{
    u_number  = fsVarsGetUnitId("number");
    u_degrees = fsVarsGetUnitId("degrees");
    u_feet    = fsVarsGetUnitId("feet");

    a_lat = fsVarsGetAVarId("PLANE LATITUDE");
    a_lon = fsVarsGetAVarId("PLANE LONGITUDE");
    a_alt = fsVarsGetAVarId("PLANE ALTITUDE");
    a_hdg = fsVarsGetAVarId("PLANE HEADING DEGREES TRUE");

    l_alive      = fsVarsRegisterLVar("CROSSCHECK_P12_ALIVE");
    l_mode       = fsVarsRegisterLVar("CROSSCHECK_P12_MODE");
    l_object     = fsVarsRegisterLVar("CROSSCHECK_P12_OBJECT");
    l_fwd        = fsVarsRegisterLVar("CROSSCHECK_P12_FWD");
    l_right      = fsVarsRegisterLVar("CROSSCHECK_P12_RIGHT");
    l_up         = fsVarsRegisterLVar("CROSSCHECK_P12_UP");
    l_frames     = fsVarsRegisterLVar("CROSSCHECK_P12_FRAMES");
    l_errors     = fsVarsRegisterLVar("CROSSCHECK_P12_ERRORS");
    l_last_error = fsVarsRegisterLVar("CROSSCHECK_P12_LAST_ERROR");

    // Off until the probe says otherwise, whatever an earlier session left.
    put(l_mode, 0);

    if (FAILED(SimConnect_Open(&h_sim, "CROSSCHECK p12 follow", nullptr, 0, 0, 0)))
    {
        h_sim = 0;
        return;
    }
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE LATITUDE", "degrees");
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE LONGITUDE", "degrees");
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE ALTITUDE", "feet");
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE HEADING DEGREES TRUE", "degrees");
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
    if (h_sim != 0) (void)SimConnect_Close(h_sim);
    h_sim = 0;
}

extern "C" MSFS_CALLBACK void Update_StandAlone(float)
{
    put(l_alive, get(l_alive) + 1);
    if (h_sim != 0) (void)SimConnect_CallDispatch(h_sim, on_dispatch, nullptr);

    const int    mode   = static_cast<int>(get(l_mode));
    const double object = get(l_object);
    if (mode == 0 || object <= 0) return;

    Pos a{};
    if (!read_aircraft(a))
    {
        fail(-1);
        return;
    }
    const Pos p = place(a, get(l_fwd), get(l_right), get(l_up));

    if (mode == 1)
    {
        const FsObjectId target = static_cast<FsObjectId>(object);
        FsVarParamArray  none;
        const FsVarError errors[] = {
            fsVarsAVarSet(a_lat, u_degrees, none, p.lat, target),
            fsVarsAVarSet(a_lon, u_degrees, none, p.lon, target),
            fsVarsAVarSet(a_alt, u_feet, none, p.alt, target),
            fsVarsAVarSet(a_hdg, u_degrees, none, p.hdg, target),
        };
        for (FsVarError e : errors)
            if (e != FS_VAR_ERROR_NONE)
            {
                fail(static_cast<double>(e));
                break;
            }
    }
    else if (mode == 2 && h_sim != 0)
    {
        Pos copy = p;
        if (FAILED(SimConnect_SetDataOnSimObject(h_sim, DEF_POS, static_cast<SIMCONNECT_OBJECT_ID>(object), 0, 0,
                                                 sizeof(copy), &copy)))
            fail(2000);
    }
    put(l_frames, get(l_frames) + 1);
}
