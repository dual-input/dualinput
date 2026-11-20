//! Where a flight departed, from the flight file the sim names in `FlightLoaded`, which Go to
//! reads to put a joining pilot at the pilot flying's airport and stand (record/areas/session/
//! 02-units.md, "Go to").

/// A flight's departure: its `[Departure]` section's `ICAO`, `GateName`, and `GateNumber`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Departure {
    /// The airport, such as `EGBB`.
    pub airport: String,
    /// The stand's name as the file writes it, such as `GATE` or `PARKING`.
    pub stand_name: String,
    /// The stand's number, such as 58.
    pub stand_number: u32,
}

impl Departure {
    /// Reads the `[Departure]` section of a flight file's text. `None` when the file has no
    /// section or the section no `ICAO`, since Go to needs the airport, while without a
    /// stand it puts the pilot at the airport alone. So a section that names no stand reads
    /// as a stand with an empty name and the number 0.
    pub fn from_flight_file(text: &str) -> Option<Departure> {
        let mut inside = false;
        let mut airport = None;
        let mut stand_name = String::new();
        let mut stand_number = 0;
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                inside = line == "[Departure]";
                continue;
            }
            let Some((key, value)) = line.split_once('=').filter(|_| inside) else {
                continue;
            };
            let value = value.trim();
            match key.trim() {
                "ICAO" => airport = Some(value.to_string()),
                "GateName" => stand_name = value.to_string(),
                "GateNumber" => stand_number = value.parse().unwrap_or(0),
                _ => {}
            }
        }
        Some(Departure {
            airport: airport.filter(|icao| !icao.is_empty())?,
            stand_name,
            stand_number,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The section, and the sections on each side of it, verbatim, with the file's CRLF line
    /// ends (read in %APPDATA%\Microsoft Flight Simulator 2024\MISSIONS\Custom\CustomFlight\
    /// CustomFlight.FLT, as MSFS 2024 wrote it on 2026-10-21).
    #[test]
    fn reads_the_departure_the_sim_wrote() {
        let text = "[SoundPackages]\r\nNbFiles=0\r\n\r\n\
                    [Departure]\r\nICAO=EGBB\r\nGateName=GATE\r\nGateNumber=58\r\n\
                    GateSuffix=NONE\r\nRunwayNumber=33\r\nRunwayDesignator=NONE\r\n\r\n\
                    [TrafficOptions]\r\nAllowAmbientVehicleTraffic=True\r\n";
        assert_eq!(
            Departure::from_flight_file(text),
            Some(Departure {
                airport: "EGBB".into(),
                stand_name: "GATE".into(),
                stand_number: 58,
            })
        );
    }

    /// The stand the interface log read after a stand was picked on the world map,
    /// `GateName=PARKING; GateNumber=140`, at KSEA, the airport that entry's world map set
    /// (measured on MSFS 2024, 2026-10-05, record/areas/interface/log.md), written here with
    /// spaces around each `=`.
    #[test]
    fn spaces_around_the_equals_sign_read_the_same() {
        let text = "[Departure]\nICAO = KSEA\nGateName = PARKING\nGateNumber = 140\n";
        let departure = Departure::from_flight_file(text).unwrap();
        assert_eq!(departure.stand_name, "PARKING");
        assert_eq!(departure.stand_number, 140);
    }

    #[test]
    fn a_file_without_the_section_has_no_departure() {
        let text = "[SoundPackages]\r\nNbFiles=0\r\n\r\n[TrafficOptions]\r\nICAO=EGBB\r\n";
        assert_eq!(Departure::from_flight_file(text), None);
    }
}
