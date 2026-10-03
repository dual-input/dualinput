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
 *   MODE     0 off; 1 fsVarsAVarSet at an offset from the aircraft;
 *            2 SimConnect_SetDataOnSimObject at that offset;
 *            3 fsVarsAVarSet on the seat object's own position
 *   OBJECT   the object's SimConnect ID
 *   SEAT     the seat object's SimConnect ID, for mode 3
 *   FWD, RIGHT, UP   modes 1 and 2: where to put the object, in meters from
 *                    the aircraft's reference point, turned by heading only;
 *                    mode 3: UP is meters above the seat object
 *
 * Every mode gives the object the aircraft's heading, pitch, and bank. It
 * reports back through ALIVE (every frame), FRAMES (every frame it wrote),
 * ERRORS, LAST_ERROR (an FsVarError, or 1000 + a SimConnect exception), and
 * SEAT_FWD, SEAT_RIGHT, SEAT_UP: where the seat object is from the aircraft's
 * reference point, read inside this frame, turned by heading only.
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
    double lat, lon, alt, hdg, pitch, bank;
};

HANDLE h_sim = 0;

FsUnitId u_number, u_degrees, u_feet;
FsAVarId a_lat, a_lon, a_alt, a_hdg, a_pitch, a_bank;
FsLVarId l_alive, l_mode, l_object, l_seat, l_fwd, l_right, l_up, l_frames, l_errors, l_last_error;
FsLVarId l_seat_fwd, l_seat_right, l_seat_up;

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

bool read_pose(Pos& a, FsObjectId object)
{
    FsVarParamArray none;
    return fsVarsAVarGet(a_lat, u_degrees, none, &a.lat, object) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_lon, u_degrees, none, &a.lon, object) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_alt, u_feet, none, &a.alt, object) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_hdg, u_degrees, none, &a.hdg, object) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_pitch, u_degrees, none, &a.pitch, object) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_bank, u_degrees, none, &a.bank, object) == FS_VAR_ERROR_NONE;
}

// The same turn as experiments/areas/avatars/lib/pose.mjs, toWorld.
Pos place(const Pos& a, double fwd, double right, double up)
{
    const double h     = a.hdg * RAD;
    const double north = fwd * std::cos(h) - right * std::sin(h);
    const double east  = fwd * std::sin(h) + right * std::cos(h);
    return Pos{a.lat + (north / EARTH_M) / RAD, a.lon + (east / (EARTH_M * std::cos(a.lat * RAD))) / RAD,
               a.alt + up / FT, a.hdg, a.pitch, a.bank};
}

// And its toBody: where p is from a, forward, right, and up, in meters.
void body(const Pos& a, const Pos& p, double& fwd, double& right, double& up)
{
    const double north = (p.lat - a.lat) * RAD * EARTH_M;
    const double east  = (p.lon - a.lon) * RAD * EARTH_M * std::cos(a.lat * RAD);
    const double h     = a.hdg * RAD;
    fwd                = north * std::cos(h) + east * std::sin(h);
    right              = -north * std::sin(h) + east * std::cos(h);
    up                 = (p.alt - a.alt) * FT;
}

bool write_pose(FsObjectId target, const Pos& p)
{
    FsVarParamArray  none;
    const FsVarError errors[] = {
        fsVarsAVarSet(a_lat, u_degrees, none, p.lat, target),
        fsVarsAVarSet(a_lon, u_degrees, none, p.lon, target),
        fsVarsAVarSet(a_alt, u_feet, none, p.alt, target),
        fsVarsAVarSet(a_hdg, u_degrees, none, p.hdg, target),
        fsVarsAVarSet(a_pitch, u_degrees, none, p.pitch, target),
        fsVarsAVarSet(a_bank, u_degrees, none, p.bank, target),
    };
    for (FsVarError e : errors)
        if (e != FS_VAR_ERROR_NONE)
        {
            fail(static_cast<double>(e));
            return false;
        }
    return true;
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
    a_hdg   = fsVarsGetAVarId("PLANE HEADING DEGREES TRUE");
    a_pitch = fsVarsGetAVarId("PLANE PITCH DEGREES");
    a_bank  = fsVarsGetAVarId("PLANE BANK DEGREES");

    l_alive      = fsVarsRegisterLVar("CROSSCHECK_P12_ALIVE");
    l_mode       = fsVarsRegisterLVar("CROSSCHECK_P12_MODE");
    l_object     = fsVarsRegisterLVar("CROSSCHECK_P12_OBJECT");
    l_seat       = fsVarsRegisterLVar("CROSSCHECK_P12_SEAT");
    l_fwd        = fsVarsRegisterLVar("CROSSCHECK_P12_FWD");
    l_right      = fsVarsRegisterLVar("CROSSCHECK_P12_RIGHT");
    l_up         = fsVarsRegisterLVar("CROSSCHECK_P12_UP");
    l_frames     = fsVarsRegisterLVar("CROSSCHECK_P12_FRAMES");
    l_errors     = fsVarsRegisterLVar("CROSSCHECK_P12_ERRORS");
    l_last_error = fsVarsRegisterLVar("CROSSCHECK_P12_LAST_ERROR");
    l_seat_fwd   = fsVarsRegisterLVar("CROSSCHECK_P12_SEAT_FWD");
    l_seat_right = fsVarsRegisterLVar("CROSSCHECK_P12_SEAT_RIGHT");
    l_seat_up    = fsVarsRegisterLVar("CROSSCHECK_P12_SEAT_UP");

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
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE PITCH DEGREES", "degrees");
    (void)SimConnect_AddToDataDefinition(h_sim, DEF_POS, "PLANE BANK DEGREES", "degrees");
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
    const double seat   = get(l_seat);

    Pos a{};
    const bool have_aircraft = read_pose(a, FS_OBJECT_ID_USER_AIRCRAFT);

    // Where the seat object reads from inside this frame, written whatever the
    // mode, so the probe can compare it with SimConnect's reading from outside.
    Pos s{};
    const bool have_seat = seat > 0 && have_aircraft && read_pose(s, static_cast<FsObjectId>(seat));
    if (have_seat)
    {
        double f, r, u;
        body(a, s, f, r, u);
        put(l_seat_fwd, f);
        put(l_seat_right, r);
        put(l_seat_up, u);
    }

    if (mode == 0 || object <= 0) return;
    if (!have_aircraft)
    {
        fail(-1);
        return;
    }
    const FsObjectId target = static_cast<FsObjectId>(object);
    const Pos        p      = place(a, get(l_fwd), get(l_right), get(l_up));

    if (mode == 1)
    {
        (void)write_pose(target, p);
    }
    else if (mode == 3)
    {
        if (!have_seat)
        {
            fail(-3);
            return;
        }
        (void)write_pose(target, Pos{s.lat, s.lon, s.alt + get(l_up) / FT, a.hdg, a.pitch, a.bank});
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
