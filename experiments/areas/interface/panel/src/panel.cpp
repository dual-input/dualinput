/*
 * crosscheck-p02-panel: places one object, the floating panel, in front of the
 * pilot's view every frame from inside the sim, for
 * experiments/areas/interface/p02-floating-panel.mjs.
 *
 * Where the pilot looks comes from fsCameraGet in the SIMOBJECT referential:
 * the eye in the aircraft model's own space, x left, y up, z forward, in
 * meters, with the yaw in FsPBH's b (right positive), the pitch in p (down
 * positive), and the roll in h (record/areas/avatars/log.md, p06, p07, p20).
 * The panel is placed relative to the aircraft, not at the camera's WORLD
 * position, because a write from Update_StandAlone shows a frame after the
 * aircraft is drawn, and a flying aircraft's seat read a frame old: placed
 * from the aircraft's pose led by about one frame, a seated figure held its
 * seat (record/areas/avatars/log.md, p13 to p16).
 *
 * The probe drives it through L: variables, all CROSSCHECK_P02_:
 *
 *   MODE      0 off; 1 locked to the view; 2 following the view lazily;
 *             3 pinned where it was when the mode began, in the aircraft
 *   OBJECT    the panel's SimConnect object ID
 *   DIST      meters from the eye to the panel's middle, along the look
 *   DOWN, RIGHT   meters the panel's middle sits below and right of the
 *             line of sight, in the view's own frame
 *   LEAD      frames to carry the aircraft's pose on, as the seated figure
 *   CAM_LEAD  frames to carry the look on, by its change since the previous
 *             frame, for a camera reading that may be a frame old
 *   LAZY_S    mode 2: seconds the panel takes to close most of the angle to
 *             the look, as 1 - e^(-dt / LAZY_S) of it each frame
 *   DEAD_DEG  mode 2: the panel starts moving only once the look is this many
 *             degrees away, and then follows until it's within 1 degree
 *   ROLL      1 to roll the panel with the view, 0 to keep it level
 *   SIGN_PITCH, SIGN_BANK   how A:PLANE PITCH DEGREES and A:PLANE BANK
 *             DEGREES map to nose up and right wing down: -1 and -1 (p15)
 *
 * It reports through ALIVE (every frame), FRAMES (every frame it wrote), ERRORS
 * and LAST_ERROR (an FsVarError), CAM_OK, CAM_X, CAM_Y, CAM_Z, CAM_YAW,
 * CAM_PITCH, CAM_ROLL (the camera as read), PANEL_YAW and PANEL_PITCH (where
 * the panel points, degrees from the aircraft's nose), and DT (seconds).
 */

#include <MSFS/MSFS.h>
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Vars.h>
#include <MSFS/MSFS_Camera.h>
#include <cmath>

namespace
{
const double PI      = 3.14159265358979323846;
const double RAD     = PI / 180.0;
const double EARTH_M = 6371000.0;
const double FT      = 0.3048;

struct Pos
{
    double lat, lon, alt, hdg, pitch, bank;
};

// A 3x3 rotation, row-major, in a frame of forward, right, and down.
struct M3
{
    double m[3][3];
};

M3 mul(const M3& a, const M3& b)
{
    M3 r{};
    for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
            r.m[i][j] = a.m[i][0] * b.m[0][j] + a.m[i][1] * b.m[1][j] + a.m[i][2] * b.m[2][j];
    return r;
}

// Yaw right, then pitch nose up, then roll right wing down, in radians: the
// usual aerospace order, turning the body's axes into the frame above it.
M3 euler(double yaw, double pitch, double roll)
{
    const double cy = std::cos(yaw), sy = std::sin(yaw);
    const double cp = std::cos(pitch), sp = std::sin(pitch);
    const double cr = std::cos(roll), sr = std::sin(roll);
    const M3     z{{{cy, -sy, 0}, {sy, cy, 0}, {0, 0, 1}}};
    const M3     y{{{cp, 0, sp}, {0, 1, 0}, {-sp, 0, cp}}};
    const M3     x{{{1, 0, 0}, {0, cr, -sr}, {0, sr, cr}}};
    return mul(z, mul(y, x));
}

FsUnitId u_number, u_degrees, u_feet;
FsAVarId a_lat, a_lon, a_alt, a_hdg, a_pitch, a_bank;
FsLVarId l_alive, l_mode, l_object, l_dist, l_down, l_right, l_lead, l_cam_lead, l_lazy_s, l_dead_deg, l_roll;
FsLVarId l_sign_pitch, l_sign_bank, l_frames, l_errors, l_last_error, l_cam_ok, l_cam_x, l_cam_y, l_cam_z;
FsLVarId l_cam_yaw, l_cam_pitch, l_cam_roll, l_panel_yaw, l_panel_pitch, l_dt;

Pos  prev{};
bool have_prev = false;

// The look in the previous frame, for CAM_LEAD.
double prev_yaw = 0, prev_pitch = 0;
bool   have_prev_look = false;

// Where the panel points, in degrees from the aircraft's nose, for modes 2
// and 3, and in mode 3 the eye it's measured from.
double panel_yaw = 0, panel_pitch = 0, panel_roll = 0;
bool   following = false;
double pin_fwd = 0, pin_right = 0, pin_up = 0;
int    last_mode = 0;

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

double wrap(double deg)
{
    while (deg > 180) deg -= 360;
    while (deg < -180) deg += 360;
    return deg;
}

bool read_pose(Pos& a)
{
    FsVarParamArray none;
    return fsVarsAVarGet(a_lat, u_degrees, none, &a.lat, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_lon, u_degrees, none, &a.lon, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_alt, u_feet, none, &a.alt, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_hdg, u_degrees, none, &a.hdg, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_pitch, u_degrees, none, &a.pitch, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE &&
           fsVarsAVarGet(a_bank, u_degrees, none, &a.bank, FS_OBJECT_ID_USER_AIRCRAFT) == FS_VAR_ERROR_NONE;
}

// The aircraft's pose carried on by lead times its change since prev
// (crosscheck-p12-follow, experiments/areas/avatars/wasm/src/follow.cpp).
Pos ahead(const Pos& a, const Pos& p, double lead)
{
    const double dh = wrap(a.hdg - p.hdg);
    return Pos{a.lat + (a.lat - p.lat) * lead, a.lon + (a.lon - p.lon) * lead, a.alt + (a.alt - p.alt) * lead,
               a.hdg + dh * lead,             a.pitch + (a.pitch - p.pitch) * lead, a.bank + (a.bank - p.bank) * lead};
}

// The point fwd, right, and up meters from the aircraft in its own frame, in
// the world, with the aircraft turned by r.
Pos place(const Pos& a, const M3& r, double fwd, double right, double up)
{
    const double down  = -up;
    const double north = r.m[0][0] * fwd + r.m[0][1] * right + r.m[0][2] * down;
    const double east  = r.m[1][0] * fwd + r.m[1][1] * right + r.m[1][2] * down;
    const double d     = r.m[2][0] * fwd + r.m[2][1] * right + r.m[2][2] * down;
    return Pos{a.lat + (north / EARTH_M) / RAD, a.lon + (east / (EARTH_M * std::cos(a.lat * RAD))) / RAD, a.alt - d / FT, 0, 0, 0};
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

    a_lat   = fsVarsGetAVarId("PLANE LATITUDE");
    a_lon   = fsVarsGetAVarId("PLANE LONGITUDE");
    a_alt   = fsVarsGetAVarId("PLANE ALTITUDE");
    a_hdg   = fsVarsGetAVarId("PLANE HEADING DEGREES TRUE");
    a_pitch = fsVarsGetAVarId("PLANE PITCH DEGREES");
    a_bank  = fsVarsGetAVarId("PLANE BANK DEGREES");

    l_alive       = fsVarsRegisterLVar("CROSSCHECK_P02_ALIVE");
    l_mode        = fsVarsRegisterLVar("CROSSCHECK_P02_MODE");
    l_object      = fsVarsRegisterLVar("CROSSCHECK_P02_OBJECT");
    l_dist        = fsVarsRegisterLVar("CROSSCHECK_P02_DIST");
    l_down        = fsVarsRegisterLVar("CROSSCHECK_P02_DOWN");
    l_right       = fsVarsRegisterLVar("CROSSCHECK_P02_RIGHT");
    l_lead        = fsVarsRegisterLVar("CROSSCHECK_P02_LEAD");
    l_cam_lead    = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_LEAD");
    l_lazy_s      = fsVarsRegisterLVar("CROSSCHECK_P02_LAZY_S");
    l_dead_deg    = fsVarsRegisterLVar("CROSSCHECK_P02_DEAD_DEG");
    l_roll        = fsVarsRegisterLVar("CROSSCHECK_P02_ROLL");
    l_sign_pitch  = fsVarsRegisterLVar("CROSSCHECK_P02_SIGN_PITCH");
    l_sign_bank   = fsVarsRegisterLVar("CROSSCHECK_P02_SIGN_BANK");
    l_frames      = fsVarsRegisterLVar("CROSSCHECK_P02_FRAMES");
    l_errors      = fsVarsRegisterLVar("CROSSCHECK_P02_ERRORS");
    l_last_error  = fsVarsRegisterLVar("CROSSCHECK_P02_LAST_ERROR");
    l_cam_ok      = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_OK");
    l_cam_x       = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_X");
    l_cam_y       = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_Y");
    l_cam_z       = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_Z");
    l_cam_yaw     = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_YAW");
    l_cam_pitch   = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_PITCH");
    l_cam_roll    = fsVarsRegisterLVar("CROSSCHECK_P02_CAM_ROLL");
    l_panel_yaw   = fsVarsRegisterLVar("CROSSCHECK_P02_PANEL_YAW");
    l_panel_pitch = fsVarsRegisterLVar("CROSSCHECK_P02_PANEL_PITCH");
    l_dt          = fsVarsRegisterLVar("CROSSCHECK_P02_DT");

    // Off until the probe says otherwise, whatever an earlier session left.
    put(l_mode, 0);
}

extern "C" MSFS_CALLBACK void module_deinit(void) {}

extern "C" MSFS_CALLBACK void Update_StandAlone(float dt)
{
    put(l_alive, get(l_alive) + 1);
    put(l_dt, dt);

    Pos        a{};
    const bool have_aircraft = read_pose(a);
    const Pos  a_ahead       = have_prev ? ahead(a, prev, get(l_lead)) : a;
    prev                     = a;
    have_prev                = have_aircraft;

    FsCameraData cam{};
    const bool   have_cam = fsCameraGet(FS_POSITION_REFERENTIAL_SIMOBJECT, &cam);
    put(l_cam_ok, have_cam ? 1 : 0);
    if (!have_cam) return;
    // The eye in the aircraft's frame: forward, right, up.
    const double eye_fwd = cam.position.z, eye_right = -cam.position.x, eye_up = cam.position.y;
    // The look: yaw right, pitch up, roll right, in degrees.
    double yaw = cam.pbh.b, pitch = -cam.pbh.p;
    const double roll = get(l_roll) != 0 ? cam.pbh.h : 0;
    put(l_cam_x, cam.position.x);
    put(l_cam_y, cam.position.y);
    put(l_cam_z, cam.position.z);
    put(l_cam_yaw, yaw);
    put(l_cam_pitch, pitch);
    put(l_cam_roll, cam.pbh.h);

    const double cam_lead = get(l_cam_lead);
    if (have_prev_look && cam_lead != 0)
    {
        const double dy = wrap(yaw - prev_yaw), dp = pitch - prev_pitch;
        prev_yaw   = yaw;
        prev_pitch = pitch;
        yaw += dy * cam_lead;
        pitch += dp * cam_lead;
    }
    else
    {
        prev_yaw   = yaw;
        prev_pitch = pitch;
    }
    have_prev_look = true;

    const int    mode   = static_cast<int>(get(l_mode));
    const double object = get(l_object);
    if (mode == 0 || object <= 0 || !have_aircraft)
    {
        last_mode = mode;
        following = false;
        return;
    }

    double fwd0 = eye_fwd, right0 = eye_right, up0 = eye_up;
    if (mode == 1 || last_mode == 0)
    {
        panel_yaw   = yaw;
        panel_pitch = pitch;
        panel_roll  = roll;
    }
    if (mode == 2)
    {
        const double off = std::hypot(wrap(yaw - panel_yaw), pitch - panel_pitch);
        if (off > get(l_dead_deg)) following = true;
        if (following)
        {
            const double s = get(l_lazy_s);
            const double k = s > 0 ? 1 - std::exp(-dt / s) : 1;
            panel_yaw += wrap(yaw - panel_yaw) * k;
            panel_pitch += (pitch - panel_pitch) * k;
            panel_roll += (roll - panel_roll) * k;
            if (off < 1) following = false;
        }
    }
    if (mode == 3)
    {
        if (last_mode != 3)
        {
            pin_fwd   = eye_fwd;
            pin_right = eye_right;
            pin_up    = eye_up;
        }
        fwd0   = pin_fwd;
        right0 = pin_right;
        up0    = pin_up;
    }
    last_mode = mode;
    put(l_panel_yaw, panel_yaw);
    put(l_panel_pitch, panel_pitch);

    // The panel's turn in the aircraft's frame, then in the world's.
    const M3 rel = euler(panel_yaw * RAD, panel_pitch * RAD, panel_roll * RAD);
    const double sp = get(l_sign_pitch), sb = get(l_sign_bank);
    const M3 air = euler(a_ahead.hdg * RAD, sp * a_ahead.pitch * RAD, sb * a_ahead.bank * RAD);
    const M3 world = mul(air, rel);

    // The panel's middle: DIST along the look, DOWN below it and RIGHT of it,
    // in the panel's own frame, whose columns are its forward, right, and
    // down axes in the aircraft's frame.
    const double dist = get(l_dist) > 0 ? get(l_dist) : 0.35;
    const double down = get(l_down), right = get(l_right);
    const double f[3] = {rel.m[0][0], rel.m[1][0], rel.m[2][0]};
    const double r[3] = {rel.m[0][1], rel.m[1][1], rel.m[2][1]};
    const double d[3] = {rel.m[0][2], rel.m[1][2], rel.m[2][2]};
    const double pf = fwd0 + dist * f[0] + right * r[0] + down * d[0];
    const double pr = right0 + dist * f[1] + right * r[1] + down * d[1];
    const double pu = up0 - (dist * f[2] + right * r[2] + down * d[2]);

    Pos p = place(a_ahead, air, pf, pr, pu);
    const double theta = std::asin(std::fmax(-1.0, std::fmin(1.0, -world.m[2][0])));
    p.hdg   = std::atan2(world.m[1][0], world.m[0][0]) / RAD;
    p.pitch = sp * theta / RAD;
    p.bank  = sb * std::atan2(world.m[2][1], world.m[2][2]) / RAD;
    if (p.hdg < 0) p.hdg += 360;

    if (write_pose(static_cast<FsObjectId>(object), p)) put(l_frames, get(l_frames) + 1);
}
