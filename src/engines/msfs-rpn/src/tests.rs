// Tests may panic.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use super::*;

/// Runs `code` with every variable it reads from the sim at `values`, in the order the code
/// names them.
fn run(code: &str, values: &[f64]) -> f64 {
    let program = compile(code).unwrap();
    program.run(&mut Scratch::default(), &|i| values[i])
}

#[test]
fn the_58ps_yoke_code_runs_and_names_its_variables() {
    // The 58P's left yoke's roll animation (read in bksq-aircraft-baronpro 0.1.1,
    // BaronProfessional_Base_INT.xml, YokePitch_L).
    let code = " (A:YOKE X POSITION WITH AP LINEAR, Percent) (L:bksq_controlLocks, bool) if{ -1 max 1 min }   2 / 50 + ";
    let program = compile(code).unwrap();
    assert_eq!(
        program.vars,
        vec![
            Var {
                kind: 'A',
                name: "YOKE X POSITION WITH AP LINEAR".into(),
                unit: "percent".into()
            },
            Var {
                kind: 'L',
                name: "bksq_controlLocks".into(),
                unit: "bool".into()
            },
        ]
    );
    assert!(!program.keeps_state);
    assert_eq!(run(code, &[40.0, 0.0]), 70.0);
    assert_eq!(
        run(code, &[40.0, 1.0]),
        50.5,
        "the locks hold the yoke within 1%"
    );
}

/// An aircraft's code can ask for anything, and a panic here ends the core, on the loop.
#[test]
fn a_case_asking_for_more_than_the_stack_holds_takes_what_is_there() {
    assert_eq!(run("5 1e30 0 case", &[]), 5.0);
}

#[test]
fn a_string_a_loop_doubles_stops_growing() {
    let program = compile("'a' :0 d scat g0").unwrap();
    program.run(&mut Scratch::default(), &|_| 0.0);
}

/// Depth alone would run this macro 10^16 times.
#[test]
fn macros_that_fan_out_stop_at_the_expansions_limit() {
    let macros: Vec<String> = (0..17).map(|i| format!("@m{}", i + 1).repeat(10)).collect();
    let mac = |name: &str| {
        let i: usize = name.strip_prefix('m')?.parse().ok()?;
        macros.get(i).map(String::as_str)
    };
    let out = expand("@m0", &|_| None, &mac);
    assert!(out.len() < 4 << 20, "{} bytes", out.len());
}

#[test]
fn if_and_els_take_the_branch_the_condition_picks() {
    let code = "(L:a) if{ 10 } els{ (L:b) if{ 20 } els{ 30 } }";
    assert_eq!(run(code, &[1.0, 0.0]), 10.0);
    assert_eq!(run(code, &[0.0, 1.0]), 20.0);
    assert_eq!(run(code, &[0.0, 0.0]), 30.0);
    assert_eq!(
        run("1 0 if{ p 2 } 5 +", &[]),
        6.0,
        "a false if{{ with no els{{ skips its block"
    );
}

#[test]
fn quit_and_goto_jump_as_the_sdk_describes() {
    assert_eq!(
        run("pi quit (L:a) (L:b) <= if{ 1 } els{ 2 }", &[]),
        std::f64::consts::PI
    );
    assert_eq!(run("1 g1 100 + :1 2 +", &[]), 3.0);
}

#[test]
fn each_word_gives_the_sdks_example() {
    let cases: &[(&str, f64)] = &[
        ("7.2 2 %", 1.2),
        ("-7.2 -2 %", -1.2),
        ("-7.2 2 pmod", 0.8),
        ("158 ++", 159.0),
        ("1005 --", 1004.0),
        ("11 /-/", -11.0),
        ("3 2 &", 2.0),
        ("8 5 |", 13.0),
        ("17 4 ^", 21.0),
        ("8 ~", -9.0),
        ("40 1 >>", 20.0),
        ("5 3 <<", 40.0),
        ("88.69 int", 88.0),
        ("-1.5 int", -1.0),
        ("-1.5 flr", -2.0),
        ("11.4 ceil", 12.0),
        ("8.4 near", 8.0),
        ("1 10 3 rng", 1.0),
        ("1 10 30 rng", 0.0),
        ("20 lg", 1.301_029_995_663_981_3),
        ("16 2 log", 4.0),
        ("4 sqr", 16.0),
        ("3 8 pow", 6561.0),
        ("-9 sign", -1.0),
        ("0 sign", 1.0),
        ("9 4 div", 2.0),
        ("-45 dnor", 315.0),
        ("0 d360", 360.0),
        ("180 dgrd rddg", 180.0),
        ("50 40 30 20 10 5 0.5 case", 10.0),
        ("50 40 30 20 10 5 1.5 case", 20.0),
        ("7 8 1 ?", 7.0),
        ("7 8 0 ?", 8.0),
        ("0x10 022 +", 34.0),
        ("5E2 5e-2 +", 500.05),
        ("'abcd' 'd' schr", 3.0),
        ("'left' 'Left' scmi", 0.0),
        ("'abcd' slen", 4.0),
        ("'B' ord", 66.0),
        // 1 2 3 r leaves 1 3 2, so `-` gives 1, and `+` 2.
        ("1 2 3 r - +", 2.0),
    ];
    for &(code, want) in cases {
        let got = run(code, &[]);
        assert!((got - want).abs() < 1e-9, "{code}: {got}, not {want}");
    }
}

#[test]
fn registers_store_load_and_pop() {
    // 1 2 3 s0 l0 leaves 1 2 3 3, and the two adds leave 1 8.
    assert_eq!(run("1 2 3 s0 l0 + +", &[]), 8.0);
    assert_eq!(run("1 2 sp0 l0 +", &[]), 3.0);
    assert!(compile("1 s50").is_err(), "the registers end at 49");
}

#[test]
fn a_kept_variable_holds_its_value_from_one_run_to_the_next() {
    let program = compile("(O:count) 1 + d (>O:count)").unwrap();
    assert!(program.keeps_state);
    let mut scratch = Scratch::default();
    let values = |_: usize| 0.0;
    assert_eq!(program.run(&mut scratch, &values), 1.0);
    assert_eq!(program.run(&mut scratch, &values), 2.0);
}

#[test]
fn an_event_takes_nothing_and_does_nothing() {
    assert_eq!(run("5 (>K:AP_MASTER) (>H:bksq_click)", &[]), 5.0);
}

#[test]
fn what_posing_cant_run_fails_to_compile_and_says_what() {
    for (code, says) in [
        ("#POWER_CODE# 100 *", "#POWER_CODE#"),
        ("@IsGpsDrivingHsi if{ 1 }", "@IsGpsDrivingHsi"),
        ("1 2 xyz", "xyz"),
        ("(M:Event) 'LeftSingle' scmp", "M:"),
        ("1 if{ 2", "left open"),
        ("1 } 2", "closes no block"),
        ("g3", "no label"),
    ] {
        let error = compile(code).err().unwrap();
        assert!(error.0.contains(says), "{code}: {error}");
    }
}

#[test]
fn parameters_and_macros_expand_into_the_code() {
    let params = |name: &str| match name {
        "NODE" => Some("Yoke_L"),
        "CODE" => Some("@Lock if{ 0 }"),
        _ => None,
    };
    let macros = |name: &str| match name {
        "Lock" => Some("(L:#NODE#_Locked, bool)"),
        _ => None,
    };
    assert_eq!(
        expand("#CODE# els{ 1 } @Unknown #MISSING#", &params, &macros),
        "(L:Yoke_L_Locked, bool) if{ 0 } els{ 1 } @Unknown #MISSING#"
    );
    let selfish = |_: &str| Some("@Me");
    assert_eq!(
        expand("@Me", &params, &selfish),
        "@Me",
        "a macro naming itself stops"
    );
}
