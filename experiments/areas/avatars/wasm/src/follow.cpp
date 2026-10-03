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
 *   LEAD     frames to write ahead: the aircraft's pose is carried on by LEAD
 *            times what it changed since the previous frame, position and
 *            attitude both. In p13 the module's writes sat a frame behind the
 *            drawn aircraft, and the seat object read a frame behind it too
 *            (record/areas/avatars/log.md).
 *   SIGN_PITCH, SIGN_BANK   how A:PLANE PITCH DEGREES and A:PLANE BANK DEGREES
 *            map to nose up and right wing down: +1, -1, or 0 to turn the
 *            offset by heading only, as versions before 0.4.0 did
 *   CAL_FWD, CAL_RIGHT, CAL_UP   the seat object's parked offset, for the
 *            calibration below
 *   CAL_RESET   set to 1 to restart the calibration; the module sets it to 0
 *
 * Every mode gives the object the aircraft's heading, pitch, and bank. It
 * reports back through ALIVE (every frame), FRAMES (every frame it wrote),
 * ERRORS, LAST_ERROR (an FsVarError, or 1000 + a SimConnect exception), and
 * SEAT_FWD, SEAT_RIGHT, SEAT_UP: where the seat object is from the aircraft's
 * reference point, read inside this frame, turned by heading only.
 *
 * The calibration predicts where the seat object is every frame, from its
 * parked offset turned by each of the four pairs of signs, once from this
 * frame's aircraft pose and once from the previous frame's. CAL_NOW_PP,
 * _PN, _NP, _NN and CAL_PREV_PP, ... hold each prediction's running RMS error
 * in meters, P and N for the sign of pitch then bank. The sim carries the seat
 * object through pitch and roll itself, so the pair near zero is the
 * convention, and NOW against PREV says which frame's pose the seat follows.
 */

#include <MSFS/MSFS.h>
// DWORD and HANDLE, which SimConnect.h assumes (fsc-editor, link/src/module.cpp).
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Vars.h>
#include <SimConnect.h>
#include <cmath>
#include <cstdio>

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
FsLVarId l_seat_fwd, l_seat_right, l_seat_up, l_lead;
FsLVarId l_sign_pitch, l_sign_bank, l_cal_fwd, l_cal_right, l_cal_up, l_cal_reset;
FsLVarId l_cal_now[4], l_cal_prev[4];

// The four sign pairs, pitch then bank, in the order of the CAL_ names.
const double SIGNS[4][2]  = {{1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
const char*  SUFFIXES[4]  = {"PP", "PN", "NP", "NN"};
double       ms_now[4]    = {0, 0, 0, 0};
double       ms_prev[4]   = {0, 0, 0, 0};
bool         cal_started  = false;
// Each frame's squared error is mixed in at this weight: about a 2s memory
// at 30 frames a second.
const double CAL_WEIGHT = 0.02;

// The aircraft's pose in the previous frame, for the lead and the calibration.
Pos  prev{};
bool have_prev = false;

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

// The point fwd, right, and up meters from the aircraft in its own frame,
// turned by heading, then pitch and bank with the signs given (0 leaves them
// out). Yaw, then pitch, then roll, the usual aerospace order, with nose up
// and right wing down positive once the signs are applied.
Pos place(const Pos& a, double fwd, double right, double up, double sign_pitch, double sign_bank)
{
    const double th = sign_pitch * a.pitch * RAD;
    const double ph = sign_bank * a.bank * RAD;
    const double ps = a.hdg * RAD;
    const double down = -up;
    // Roll about the forward axis, then pitch about the right axis, then yaw.
    const double y1 = std::cos(ph) * right - std::sin(ph) * down;
    const double z1 = std::sin(ph) * right + std::cos(ph) * down;
    const double x2 = std::cos(th) * fwd + std::sin(th) * z1;
    const double z2 = -std::sin(th) * fwd + std::cos(th) * z1;
    const double north = std::cos(ps) * x2 - std::sin(ps) * y1;
    const double east  = std::sin(ps) * x2 + std::cos(ps) * y1;
    return Pos{a.lat + (north / EARTH_M) / RAD, a.lon + (east / (EARTH_M * std::cos(a.lat * RAD))) / RAD,
               a.alt - z2 / FT, a.hdg, a.pitch, a.bank};
}

// Meters between two positions.
double apart(const Pos& p, const Pos& q)
{
    const double north = (q.lat - p.lat) * RAD * EARTH_M;
    const double east  = (q.lon - p.lon) * RAD * EARTH_M * std::cos(p.lat * RAD);
    const double up    = (q.alt - p.alt) * FT;
    return std::sqrt(north * north + east * east + up * up);
}

// The aircraft's pose carried on by lead times its change since prev.
Pos ahead(const Pos& a, const Pos& prev, double lead)
{
    double dh = a.hdg - prev.hdg;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return Pos{a.lat + (a.lat - prev.lat) * lead, a.lon + (a.lon - prev.lon) * lead, a.alt + (a.alt - prev.alt) * lead,
               a.hdg + dh * lead,                 a.pitch + (a.pitch - prev.pitch) * lead, a.bank + (a.bank - prev.bank) * lead};
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
    l_lead       = fsVarsRegisterLVar("CROSSCHECK_P12_LEAD");
    l_sign_pitch = fsVarsRegisterLVar("CROSSCHECK_P12_SIGN_PITCH");
    l_sign_bank  = fsVarsRegisterLVar("CROSSCHECK_P12_SIGN_BANK");
    l_cal_fwd    = fsVarsRegisterLVar("CROSSCHECK_P12_CAL_FWD");
    l_cal_right  = fsVarsRegisterLVar("CROSSCHECK_P12_CAL_RIGHT");
    l_cal_up     = fsVarsRegisterLVar("CROSSCHECK_P12_CAL_UP");
    l_cal_reset  = fsVarsRegisterLVar("CROSSCHECK_P12_CAL_RESET");
    for (int i = 0; i < 4; i++)
    {
        char name[48];
        (void)snprintf(name, sizeof(name), "CROSSCHECK_P12_CAL_NOW_%s", SUFFIXES[i]);
        l_cal_now[i] = fsVarsRegisterLVar(name);
        (void)snprintf(name, sizeof(name), "CROSSCHECK_P12_CAL_PREV_%s", SUFFIXES[i]);
        l_cal_prev[i] = fsVarsRegisterLVar(name);
    }

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

    // The calibration: where each sign pair puts the seat, from this frame's
    // pose and from the previous frame's, against where the seat object is.
    if (get(l_cal_reset) != 0)
    {
        for (int i = 0; i < 4; i++) ms_now[i] = ms_prev[i] = 0;
        cal_started = false;
        put(l_cal_reset, 0);
    }
    if (have_seat && have_prev)
    {
        const double cf = get(l_cal_fwd), cr = get(l_cal_right), cu = get(l_cal_up);
        for (int i = 0; i < 4; i++)
        {
            const double e_now  = apart(place(a, cf, cr, cu, SIGNS[i][0], SIGNS[i][1]), s);
            const double e_prev = apart(place(prev, cf, cr, cu, SIGNS[i][0], SIGNS[i][1]), s);
            ms_now[i]  = cal_started ? ms_now[i] + CAL_WEIGHT * (e_now * e_now - ms_now[i]) : e_now * e_now;
            ms_prev[i] = cal_started ? ms_prev[i] + CAL_WEIGHT * (e_prev * e_prev - ms_prev[i]) : e_prev * e_prev;
            put(l_cal_now[i], std::sqrt(ms_now[i]));
            put(l_cal_prev[i], std::sqrt(ms_prev[i]));
        }
        cal_started = true;
    }

    // The aircraft's pose carried on by the lead.
    const Pos  a_ahead = have_prev ? ahead(a, prev, get(l_lead)) : a;
    const Pos  s_ahead = have_prev && have_seat ? ahead(s, Pos{s.lat - (a.lat - prev.lat), s.lon - (a.lon - prev.lon),
                                                               s.alt - (a.alt - prev.alt), s.hdg, s.pitch, s.bank},
                                                          get(l_lead))
                                                : s;
    prev      = a;
    have_prev = have_aircraft;

    if (mode == 0 || object <= 0) return;
    if (!have_aircraft)
    {
        fail(-1);
        return;
    }
    const FsObjectId target = static_cast<FsObjectId>(object);
    const Pos p = place(a_ahead, get(l_fwd), get(l_right), get(l_up), get(l_sign_pitch), get(l_sign_bank));

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
        (void)write_pose(target, Pos{s_ahead.lat, s_ahead.lon, s_ahead.alt + get(l_up) / FT, a_ahead.hdg, a_ahead.pitch, a_ahead.bank});
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
