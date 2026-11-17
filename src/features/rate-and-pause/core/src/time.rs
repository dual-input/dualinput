//! The match check's time of day: the sims' dates and times of day aren't synced, so a crew whose
//! sims differ by more than 10 minutes, or are on different dates, sees a warning
//! (record/areas/session/02-units.md, "The match check").

use messages::rate_and_pause::TimeOfDay;
use messages::session::Severity;
use session::Found;
use sim_service::Value;

/// How far apart two times of day may be, in seconds, before they differ.
const WITHIN: u32 = 10 * 60;

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// The time of day from a read of `E:ZULU TIME`, `E:ZULU DAY OF MONTH`, `E:ZULU MONTH OF YEAR`,
/// and `E:ZULU YEAR`, in that order.
pub(crate) fn read(values: &[(usize, Value)]) -> Option<TimeOfDay> {
    let number = |place: usize| {
        values.iter().find_map(|(p, v)| match v {
            Value::Number(n) if *p == place => Some(*n),
            _ => None,
        })
    };
    Some(TimeOfDay {
        seconds: number(0)? as u32,
        day: number(1)? as u8,
        month: number(2)? as u8,
        year: number(3)? as u16,
    })
}

/// Different dates, or times of day more than 10 minutes apart, as a warning. The words are the
/// frames' (`HEADS_UP` in experiments/areas/interface/bench/src/frames/home.tsx), from the side of
/// the pilot reading them, `mine`, for each crewmate whose sim differs, and a date names only the
/// crewmate's, since this pilot sees their own (user, 2026-11-17). A pilot out of the flight, whose
/// value isn't among them, reads each pilot's.
pub(crate) fn compare(values: &[(String, TimeOfDay)], mine: Option<usize>) -> Option<Found> {
    let date = |t: &TimeOfDay| (t.year, t.month, t.day);
    let Some(&(_, me)) = mine.and_then(|i| values.get(i)) else {
        return listed_compare(values);
    };
    let said: Vec<String> = values
        .iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != mine)
        .filter_map(|(_, (name, t))| {
            if date(t) != date(&me) {
                return Some(format!("{name}'s sim is on {}", day(t, t.year != me.year)));
            }
            let apart = t.seconds.abs_diff(me.seconds);
            if apart <= WITHIN {
                return None;
            }
            let by = span(apart);
            Some(if t.seconds > me.seconds {
                format!("{name}'s sim is {by} ahead of yours")
            } else {
                format!("Your sim is {by} ahead of {name}'s")
            })
        })
        .collect();
    (!said.is_empty()).then(|| warning(said.join("; ")))
}

/// The same differences for a pilot out of the flight, as each pilot's date or time.
fn listed_compare(values: &[(String, TimeOfDay)]) -> Option<Found> {
    let first = values.first()?.1;
    let date = |t: &TimeOfDay| (t.year, t.month, t.day);
    if values.iter().any(|(_, t)| date(t) != date(&first)) {
        let years = values.iter().any(|(_, t)| t.year != first.year);
        return Some(warning(format!(
            "Sim dates differ: {}",
            listed(values, |t| day(t, years))
        )));
    }
    let earliest = values.iter().map(|(_, t)| t.seconds).min()?;
    let latest = values.iter().map(|(_, t)| t.seconds).max()?;
    (latest - earliest > WITHIN).then(|| {
        warning(format!(
            "Sim times differ by more than 10 minutes: {}",
            listed(values, |t| format!(
                "{:02}:{:02} UTC",
                t.seconds / 3600,
                t.seconds / 60 % 60
            ))
        ))
    })
}

/// How far apart two times are, to the nearest minute, as "20 minutes", "4 hours", or "1 hour 30
/// minutes".
fn span(seconds: u32) -> String {
    let minutes = (seconds + 30) / 60;
    let count = |n: u32, unit: &str| format!("{n} {unit}{}", if n == 1 { "" } else { "s" });
    match (minutes / 60, minutes % 60) {
        (0, m) => count(m, "minute"),
        (h, 0) => count(h, "hour"),
        (h, m) => format!("{} {}", count(h, "hour"), count(m, "minute")),
    }
}
fn warning(words: String) -> Found {
    Found {
        level: Severity::Warning,
        words,
        note: None,
    }
}

/// A date as "2 March", with its year when the crew's years differ.
fn day(t: &TimeOfDay, years: bool) -> String {
    let month = MONTHS
        .get(usize::from(t.month).saturating_sub(1))
        .copied()
        .unwrap_or("");
    if years {
        format!("{} {month} {}", t.day, t.year)
    } else {
        format!("{} {month}", t.day)
    }
}

/// Each member's name and its text for a value, as "James 14:05 UTC, Adam 14:40 UTC".
fn listed(values: &[(String, TimeOfDay)], text: impl Fn(&TimeOfDay) -> String) -> String {
    values
        .iter()
        .map(|(name, t)| format!("{name} {}", text(t)))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(day: u8, seconds: u32) -> TimeOfDay {
        TimeOfDay {
            year: 2026,
            month: 11,
            day,
            seconds,
        }
    }

    fn crew(a: TimeOfDay, b: TimeOfDay) -> Vec<(String, TimeOfDay)> {
        vec![("James".into(), a), ("Adam".into(), b)]
    }

    #[test]
    fn times_within_10_minutes_show_nothing() {
        let crew = crew(at(17, 50_400), at(17, 50_400 + 600));
        assert_eq!(compare(&crew, Some(0)), None);
    }

    #[test]
    fn times_20_minutes_apart_are_a_warning_from_each_side() {
        let crew = crew(at(17, 50_700), at(17, 51_900));
        let found = compare(&crew, Some(0)).unwrap();
        assert_eq!(found.level, Severity::Warning);
        assert_eq!(found.words, "Adam's sim is 20 minutes ahead of yours");
        assert_eq!(
            compare(&crew, Some(1)).unwrap().words,
            "Your sim is 20 minutes ahead of James's"
        );
        assert_eq!(
            compare(&crew, None).unwrap().words,
            "Sim times differ by more than 10 minutes: James 14:05 UTC, Adam 14:25 UTC"
        );
    }

    #[test]
    fn hours_apart_read_in_hours() {
        let crew = crew(at(17, 36_000), at(17, 36_000 + 4 * 3600));
        assert_eq!(
            compare(&crew, Some(0)).unwrap().words,
            "Adam's sim is 4 hours ahead of yours"
        );
        assert_eq!(span(5_400), "1 hour 30 minutes");
    }

    #[test]
    fn another_date_names_the_crewmates() {
        let crew = crew(at(17, 50_400), at(2, 50_400));
        assert_eq!(
            compare(&crew, Some(0)).unwrap().words,
            "Adam's sim is on 2 November"
        );
        assert_eq!(
            compare(&crew, None).unwrap().words,
            "Sim dates differ: James 17 November, Adam 2 November"
        );
    }
    #[test]
    fn a_read_takes_each_value_by_its_place() {
        let values = [
            (3, Value::Number(2026.0)),
            (0, Value::Number(50_700.5)),
            (2, Value::Number(11.0)),
            (1, Value::Number(17.0)),
        ];
        assert_eq!(read(&values), Some(at(17, 50_700)));
    }
}
