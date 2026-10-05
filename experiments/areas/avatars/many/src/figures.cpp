/*
 * crosscheck-p28-figures: poses many copies of CROSSCHECK_FigureZ every frame,
 * each through the Z: variables of its own object, for
 * experiments/areas/avatars/p28-many-figures.mjs.
 *
 * CROSSCHECK_FigureZ is the figure p24 posed (experiments/areas/avatars/figure/),
 * built with its joints read from the object's own Z: variables rather than
 * global L: ones. p17's sphere took its size and color from Z: variables that
 * a module set on that object alone with fsVarsZVarSet (record/areas/avatars/
 * log.md, 2026-10-03, "A model of our own compiles from generated glTF, and its
 * size and color follow variables of its own object").
 *
 * The probe drives it through L: variables, all CROSSCHECK_P28_:
 *
 *   N        how many figures, at most MAX_FIGURES
 *   ID_0 …   each figure's SimConnect object ID
 *   MODE     0 writes nothing; 1 moves every joint every frame, each figure
 *            on its own phase; 2 writes every joint every frame without
 *            moving it, each figure in a pose of its own
 *
 * and it reports through ALIVE (every frame), FRAMES (every frame it wrote),
 * WRITES (Z: writes in the last frame), ERRORS, and LAST_ERROR (an FsVarError).
 */

#include <MSFS/MSFS.h>
// DWORD and HANDLE, which SimConnect.h assumes (fsc-editor, link/src/module.cpp).
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Vars.h>
#include <SimConnect.h>
#include <cmath>
#include <cstdio>

#include "channels.h"

namespace
{
const int MAX_FIGURES = 200;

HANDLE h_sim = 0;
FsUnitId u_number;
FsLVarId l_n, l_mode, l_alive, l_frames, l_writes, l_errors, l_last_error;
FsLVarId l_id[MAX_FIGURES];

// Each figure's Z: variables, registered again when its object changes.
double   z_object[MAX_FIGURES];
FsZVarId z_var[MAX_FIGURES][CHANNEL_COUNT];

double tick = 0;

double get(FsLVarId id)
{
    double v = 0;
    (void)fsVarsLVarGet(id, u_number, &v);
    return v;
}

void put(FsLVarId id, double v) { (void)fsVarsLVarSet(id, u_number, v); }

void fail(int code)
{
    put(l_errors, get(l_errors) + 1);
    put(l_last_error, code);
}

// A joint's value for one figure: the middle of its range, swung by a third of
// the range when moving, on a phase of the figure's own, so two figures never
// share a pose.
double pose(const Channel& c, int figure, int channel, bool moving)
{
    const double mid   = (c.min + c.max) / 2;
    const double swing = (c.max - c.min) / 3;
    const double phase = figure * 0.7 + channel * 1.3;
    if (c.color) return std::fmod(static_cast<double>(figure), c.max + 1);
    return mid + swing * std::sin(phase + (moving ? tick * 0.05 : 0));
}
}

extern "C" MSFS_CALLBACK void module_init(void)
{
    u_number     = fsVarsGetUnitId("number");
    l_n          = fsVarsRegisterLVar("CROSSCHECK_P28_N");
    l_mode       = fsVarsRegisterLVar("CROSSCHECK_P28_MODE");
    l_alive      = fsVarsRegisterLVar("CROSSCHECK_P28_ALIVE");
    l_frames     = fsVarsRegisterLVar("CROSSCHECK_P28_FRAMES");
    l_writes     = fsVarsRegisterLVar("CROSSCHECK_P28_WRITES");
    l_errors     = fsVarsRegisterLVar("CROSSCHECK_P28_ERRORS");
    l_last_error = fsVarsRegisterLVar("CROSSCHECK_P28_LAST_ERROR");
    for (int i = 0; i < MAX_FIGURES; i++)
    {
        char name[64];
        (void)snprintf(name, sizeof(name), "CROSSCHECK_P28_ID_%d", i);
        l_id[i]     = fsVarsRegisterLVar(name);
        z_object[i] = 0;
    }
    // Opened only so the module links as p12's does: wasm/build.mjs checks for
    // GetSimConnectVersion among the exports the sim needs.
    if (FAILED(SimConnect_Open(&h_sim, "CROSSCHECK p28 figures", nullptr, 0, 0, 0))) h_sim = 0;
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
    if (h_sim != 0) (void)SimConnect_Close(h_sim);
    h_sim = 0;
}

extern "C" MSFS_CALLBACK void Update_StandAlone(float)
{
    put(l_alive, get(l_alive) + 1);
    const int mode = static_cast<int>(get(l_mode));
    if (mode == 0)
    {
        put(l_writes, 0);
        return;
    }
    tick += 1;
    int n = static_cast<int>(get(l_n));
    if (n > MAX_FIGURES) n = MAX_FIGURES;
    int writes = 0;
    for (int i = 0; i < n; i++)
    {
        const double object = get(l_id[i]);
        if (object <= 0) continue;
        const FsObjectId target = static_cast<FsObjectId>(object);
        if (object != z_object[i])
        {
            for (int c = 0; c < CHANNEL_COUNT; c++) z_var[i][c] = fsVarsRegisterZVar(CHANNELS[c].name, target);
            z_object[i] = object;
        }
        for (int c = 0; c < CHANNEL_COUNT; c++)
        {
            const FsVarError e = fsVarsZVarSet(z_var[i][c], u_number, pose(CHANNELS[c], i, c, mode == 1), target);
            if (e != FS_VAR_ERROR_NONE) fail(static_cast<int>(e));
            else writes++;
        }
    }
    put(l_writes, writes);
    put(l_frames, get(l_frames) + 1);
}
