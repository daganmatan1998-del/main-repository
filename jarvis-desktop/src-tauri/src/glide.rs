//! The finger mouse's last mile: from "the hand was HERE a moment ago" to a
//! cursor that moves like a mouse.
//!
//! The camera gives a position about thirty times a second, each one a
//! little late. Sent straight to Windows, that is thirty small jumps a
//! second, uneven because the calls between the page and this process do not
//! arrive evenly, and a hand the tracker loses for a few frames freezes the
//! cursor and then throws it to wherever the hand is found. This module is
//! the part that turns those samples into a continuous line. It is pure
//! arithmetic (no Windows, no clock of its own), so it is tested on any
//! machine: the thread in main.rs only asks it for a position every few
//! milliseconds and hands that to SendInput.
//!
//! What it does, per axis pair (positions in monitor pixels):
//!   * COASTS. Between samples the last estimate keeps moving at the hand's
//!     speed, so the line is a line, not steps. A hand that moves slower
//!     than GATE_LO px/s is not extrapolated at all (tracker jitter must not
//!     become motion); GATE_HI px/s and over, fully.
//!   * LEADS a little. The picture is old by the time it arrives (a webcam
//!     is a tenth of a second behind); the cursor looks LEAD_MS ahead of
//!     where the hand has got to, but never more than CAP_PX, so a hand that
//!     stops dead overshoots by little and settles in a few frames. (All of
//!     it is less than the camera's own delay: the cursor still arrives at a
//!     stop from behind.) Sizes are for a 1920 px wide monitor and scale
//!     with the monitor.
//!   * BRIDGES a dropout. When samples stop coming the cursor keeps going,
//!     slowing, for at most EXTRA_MS worth of travel (DECAY_MS constant).
//!   * FOLLOWS, never jumps. The cursor chases that target with a short
//!     lag (TAU_MS), and its step is limited to the hand's speed plus
//!     SLEW_PXS, so a hand found again far away is a quick glide, not a
//!     teleport.

pub const TAU_MS: f64 = 26.0;
pub const GAP_MS: f64 = 50.0;
pub const LEAD_MS: f64 = 30.0;
pub const CAP_PX: f64 = 20.0;
/// When the page can tell how late the camera's pictures are (the browser
/// stamps each frame with the moment the camera captured it), the lead is a
/// third of that, between these; CAP_PX is for LEAD_MS and scales with it.
pub const LEAD_FRAC: f64 = 0.33;
pub const LEAD_MIN_MS: f64 = 10.0;
pub const LEAD_MAX_MS: f64 = 45.0;
pub const EXTRA_MS: f64 = 100.0;
pub const DECAY_MS: f64 = 120.0;
pub const SLEW_PXS: f64 = 2500.0;
pub const GATE_LO: f64 = 100.0;
pub const GATE_HI: f64 = 400.0;

#[derive(Clone, Copy, Debug)]
pub struct Glide {
    pub pos: (f64, f64),
    target: (f64, f64),
    vel: (f64, f64),
    at: f64,
    lead: f64,
    last: Option<f64>,
    scale: f64,
}

fn len(v: (f64, f64)) -> f64 {
    (v.0 * v.0 + v.1 * v.1).sqrt()
}

fn limit(v: (f64, f64), max: f64) -> (f64, f64) {
    let l = len(v);
    if l > max && l > 0.0 {
        (v.0 * max / l, v.1 * max / l)
    } else {
        v
    }
}

impl Glide {
    /// Starts at (x, y), where the cursor is. `scale` is the monitor width
    /// over 1920.
    pub fn new(x: f64, y: f64, now_ms: f64, scale: f64) -> Glide {
        Glide { pos: (x, y), target: (x, y), vel: (0.0, 0.0), at: now_ms, lead: LEAD_MS, last: None, scale: scale.max(0.25) }
    }

    /// A new sample: where the hand is (x, y px) and how fast it is moving
    /// (vx, vy px/s). `late_ms`, when known, is how old the camera's picture
    /// was when it arrived.
    pub fn set(&mut self, x: f64, y: f64, vx: f64, vy: f64, now_ms: f64, late_ms: Option<f64>) {
        self.lead = match late_ms {
            Some(l) if l.is_finite() && l >= 0.0 => (l * LEAD_FRAC).clamp(LEAD_MIN_MS, LEAD_MAX_MS),
            _ => LEAD_MS,
        };
        let v = (vx, vy);
        let speed = len(v) / self.scale;
        let gate = ((speed - GATE_LO) / (GATE_HI - GATE_LO)).clamp(0.0, 1.0);
        self.target = (x, y);
        self.vel = (v.0 * gate, v.1 * gate);
        self.at = now_ms;
    }

    /// Put the cursor exactly here, now, at rest (a click).
    pub fn snap(&mut self, x: f64, y: f64, now_ms: f64) {
        self.pos = (x, y);
        self.target = (x, y);
        self.vel = (0.0, 0.0);
        self.at = now_ms;
    }

    /// Where the cursor is heading at `now_ms`.
    pub fn target_at(&self, now_ms: f64) -> (f64, f64) {
        let age = (now_ms - self.at).max(0.0);
        let near = age.min(GAP_MS);
        // Where the hand has got to since the sample (the coast), and what
        // the cursor's own short lag will take off again (TAU_MS): neither is
        // a guess about the future, so neither is capped. The lead is the
        // guess, and is.
        let here = ((near + TAU_MS) / 1000.0, (near + TAU_MS) / 1000.0);
        let lead = limit(
            (self.vel.0 * self.lead / 1000.0, self.vel.1 * self.lead / 1000.0),
            CAP_PX * self.scale * self.lead / LEAD_MS,
        );
        let mut t = (self.target.0 + self.vel.0 * here.0 + lead.0, self.target.1 + self.vel.1 * here.1 + lead.1);
        if age > GAP_MS {
            let s = age - GAP_MS;
            let extra = EXTRA_MS.min(DECAY_MS * (1.0 - (-s / DECAY_MS).exp()));
            t.0 += self.vel.0 * extra / 1000.0;
            t.1 += self.vel.1 * extra / 1000.0;
        }
        t
    }

    /// One tick: the cursor's new position.
    pub fn step(&mut self, now_ms: f64) -> (f64, f64) {
        let dt = match self.last {
            Some(l) => (now_ms - l).clamp(0.0, 50.0),
            None => 0.0,
        };
        self.last = Some(now_ms);
        let t = self.target_at(now_ms);
        let k = 1.0 - (-dt / TAU_MS).exp();
        let d = ((t.0 - self.pos.0) * k, (t.1 - self.pos.1) * k);
        let cap = (len(self.vel) + SLEW_PXS * self.scale) * dt / 1000.0;
        let d = limit(d, cap);
        self.pos = (self.pos.0 + d.0, self.pos.1 + d.1);
        self.pos
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hand at `speed` px/s along x, sampled every 33 ms with a 100 ms
    /// camera delay; the cursor read every 4 ms.
    fn run(speed: f64, ms: f64, stop_at: Option<f64>) -> Vec<(f64, f64)> {
        let mut g = Glide::new(400.0, 500.0, 0.0, 1.0);
        let mut out = Vec::new();
        let mut next = 0.0;
        let mut t = 0.0;
        while t <= ms {
            while next + 100.0 <= t {
                let cap = next;
                let moving = stop_at.map_or(true, |s| cap < s);
                let c = if moving { cap } else { stop_at.unwrap() };
                g.set(400.0 + speed * c / 1000.0, 500.0, if moving { speed } else { 0.0 }, 0.0, next + 100.0, None);
                next += 33.3;
            }
            out.push(g.step(t));
            t += 4.0;
        }
        out
    }

    #[test]
    fn a_still_hand_is_a_still_cursor() {
        let o = run(0.0, 1500.0, None);
        let lo = o.iter().skip(100).map(|p| p.0).fold(f64::MAX, f64::min);
        let hi = o.iter().skip(100).map(|p| p.0).fold(f64::MIN, f64::max);
        assert!(hi - lo < 0.01, "wandered {}", hi - lo);
        assert!((o[200].0 - 400.0).abs() < 0.01);
    }

    #[test]
    fn slow_jitter_speeds_are_not_extrapolated() {
        let mut g = Glide::new(100.0, 100.0, 0.0, 1.0);
        g.set(100.0, 100.0, 60.0, -40.0, 0.0, None); // 72 px/s: under GATE_LO
        for i in 0..100 {
            g.step(i as f64 * 4.0);
        }
        assert!((g.pos.0 - 100.0).abs() < 0.01 && (g.pos.1 - 100.0).abs() < 0.01, "{:?}", g.pos);
    }

    #[test]
    fn a_moving_hand_is_a_continuous_line() {
        // 900 px/s: the cursor never steps more than the hand's own speed
        // and a little, and never goes backwards.
        let o = run(900.0, 1500.0, None);
        let mut worst = 0.0f64;
        let mut back = false;
        for w in o.windows(2).skip(150) {
            let d = w[1].0 - w[0].0;
            worst = worst.max(d);
            back |= d < -0.001;
        }
        // (a new sample's correction rides on one tick: up to twice the hand's own 3.6 px)
        assert!(worst < 900.0 * 0.004 * 2.0, "step {}", worst);
        assert!(!back, "went backwards");
        // and 25 px steps every 33 ms, the old way, are gone: at 144 Hz refresh
        let mut big = 0.0f64;
        let mut i = 150;
        while i + 2 < o.len() {
            big = big.max((o[i + 2].0 - o[i].0).abs()); // ~8 ms
            i += 1;
        }
        // (the hand's own 8 ms is 7.2 px; sending each sample straight on moved the cursor 30 px at a time)
        assert!(big < 900.0 * 0.008 * 1.75, "8 ms look {}", big);
    }

    #[test]
    fn it_does_not_trail_far_behind_a_moving_hand() {
        // The hand is where speed * t is; the samples reach us 100 ms late.
        let o = run(900.0, 1500.0, None);
        let t = 1200.0;
        let hand = 400.0 + 900.0 * t / 1000.0;
        let cur = o[(t / 4.0) as usize].0;
        let lag = hand - cur;
        assert!(lag > 40.0 && lag < 100.0, "lag {} px (the 100 ms camera delay alone is 90)", lag);
    }

    #[test]
    fn a_hand_that_stops_dead_overshoots_little() {
        let o = run(1000.0, 1400.0, Some(500.0));
        let stop = 400.0 + 1000.0 * 0.5;
        let past = o.iter().map(|p| p.0 - stop).fold(f64::MIN, f64::max);
        // The price of being less late: a hand that stops DEAD, at 1000 px/s, is passed by the coast to the next sample
        // and the lead, at most. (A hand that slows down, as hands do, is passed by a few px: chain test in the page's suite.)
        assert!(past < CAP_PX + 1000.0 * (GAP_MS * 0.7) / 1000.0 + 10.0, "overshoot {}", past);
        let end = o.last().unwrap().0;
        assert!((end - stop).abs() < 0.5, "settled at {} not {}", end, stop);
    }

    #[test]
    fn a_hand_found_again_far_away_is_a_glide_not_a_jump() {
        let mut g = Glide::new(500.0, 500.0, 0.0, 1.0);
        g.set(500.0, 500.0, 0.0, 0.0, 0.0, None);
        let mut t = 0.0;
        while t <= 400.0 {
            g.step(t);
            t += 4.0;
        }
        t -= 4.0;
        g.set(1500.0, 800.0, 0.0, 0.0, t, None);
        let mut worst = 0.0f64;
        let mut prev = g.pos;
        for _ in 0..200 {
            t += 4.0;
            let p = g.step(t);
            worst = worst.max(len((p.0 - prev.0, p.1 - prev.1)));
            prev = p;
        }
        assert!(worst <= SLEW_PXS * 0.004 * 1.05, "step {}", worst);
        assert!(len((prev.0 - 1500.0, prev.1 - 800.0)) < 0.5, "arrived at {:?}", prev);
    }

    #[test]
    fn a_dropout_is_bridged_by_slowing_travel() {
        let mut g = Glide::new(0.0, 0.0, 0.0, 1.0);
        g.set(0.0, 0.0, 800.0, 0.0, 0.0, None);
        let mut t = 0.0;
        let mut last = 0.0;
        while t < 1500.0 {
            last = g.step(t).0;
            t += 4.0;
        }
        // no new sample for 1.5 s: it has travelled a bounded distance and stopped
        let bound = CAP_PX + 800.0 * (GAP_MS + TAU_MS + EXTRA_MS) / 1000.0 + 5.0;
        assert!(last > 20.0 && last < bound, "travelled {}", last);
    }

    #[test]
    fn a_click_snaps_to_the_spot() {
        let mut g = Glide::new(0.0, 0.0, 0.0, 1.0);
        g.set(300.0, 300.0, 900.0, 0.0, 0.0, None);
        g.step(10.0);
        g.snap(250.0, 260.0, 12.0);
        assert_eq!(g.pos, (250.0, 260.0));
        let p = g.step(500.0);
        assert!((p.0 - 250.0).abs() < 0.01 && (p.1 - 260.0).abs() < 0.01, "{:?}", p);
    }

    #[test]
    fn the_lead_follows_how_late_the_camera_is() {
        let lead_of = |late: Option<f64>| {
            let mut g = Glide::new(0.0, 0.0, 0.0, 1.0);
            g.set(0.0, 0.0, 600.0, 0.0, 0.0, late);
            // the coast and the lag are the same whatever the lead is
            g.target_at(0.0).0 - 600.0 * TAU_MS / 1000.0
        };
        let unknown = lead_of(None);
        let slow_cam = lead_of(Some(150.0));
        let fast_cam = lead_of(Some(40.0));
        let nonsense = lead_of(Some(-5.0));
        assert!((unknown - 600.0 * LEAD_MS / 1000.0).abs() < 0.01, "{}", unknown);
        assert!(slow_cam > unknown && (slow_cam - 600.0 * LEAD_MAX_MS / 1000.0).abs() < 0.01, "slow {}", slow_cam);
        assert!(fast_cam < unknown && (fast_cam - 600.0 * 40.0 * LEAD_FRAC / 1000.0).abs() < 0.01, "fast {}", fast_cam);
        assert!((nonsense - unknown).abs() < 0.01, "{}", nonsense);
        // and a very late camera cannot send the cursor further than its scaled cap
        let mut g = Glide::new(0.0, 0.0, 0.0, 1.0);
        g.set(0.0, 0.0, 3000.0, 0.0, 0.0, Some(400.0));
        let t = g.target_at(0.0).0 - 3000.0 * TAU_MS / 1000.0;
        assert!((t - CAP_PX * LEAD_MAX_MS / LEAD_MS).abs() < 0.01, "{}", t);
    }

    #[test]
    fn sizes_scale_with_the_monitor() {
        // The same hand on a 3840 px monitor (scale 2) moves twice as many px/s;
        // the lead cap is twice as many px, so the overshoot is the same fraction of the screen.
        let mut g = Glide::new(0.0, 0.0, 0.0, 2.0);
        g.set(0.0, 0.0, 4000.0, 0.0, 0.0, None);
        let t = g.target_at(10.0);
        let lead = t.0 - 4000.0 * (10.0 + TAU_MS) / 1000.0; // what is left after the coast and the lag
        assert!((lead - CAP_PX * 2.0).abs() < 0.01, "lead {}", lead);
    }
}
