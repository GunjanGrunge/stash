//! Bounded segment cache. Transport validates ranges; this layer makes no self-hash claim.
use std::{collections::BTreeMap, sync::Mutex, time::Duration};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadError {
    Offline,
    Timeout,
    Io,
    LeaseExpired,
    Range,
}
#[derive(Debug, Clone)]
pub struct Segment {
    pub bytes: Vec<u8>,
}
pub trait RangeProvider: Send + Sync {
    fn fetch(&self, offset: u64, length: u64, timeout: Duration) -> Result<Segment, ReadError>;
    fn renew_lease(&self, _timeout: Duration) -> Result<(), ReadError> {
        Err(ReadError::LeaseExpired)
    }
}
struct State {
    segments: BTreeMap<u64, Vec<u8>>,
    used: u64,
}
pub struct Cache {
    segment: u64,
    timeout: Duration,
    size: u64,
    budget: u64,
    state: Mutex<State>,
}
impl Cache {
    pub fn new(segment: u64, timeout: Duration, size: u64, budget: u64) -> Self {
        assert!(segment > 0);
        Self {
            segment,
            timeout,
            size,
            budget,
            state: Mutex::new(State {
                segments: BTreeMap::new(),
                used: 0,
            }),
        }
    }
    fn end(&self, offset: u64, length: u64) -> Result<u64, ReadError> {
        offset
            .checked_add(length)
            .ok_or(ReadError::Range)
            .and_then(|end| {
                if end <= self.size {
                    Ok(end)
                } else {
                    Err(ReadError::Range)
                }
            })
    }
    fn put(&self, offset: u64, bytes: Vec<u8>) -> Result<(), ReadError> {
        let bytes_len = bytes.len() as u64;
        if bytes_len > self.budget {
            return Err(ReadError::Io);
        }
        let mut state = self.state.lock().unwrap();
        while state.used.checked_add(bytes_len).ok_or(ReadError::Io)? > self.budget {
            let oldest = *state.segments.keys().next().ok_or(ReadError::Io)?;
            let removed = state.segments.remove(&oldest).unwrap();
            state.used = state.used.saturating_sub(removed.len() as u64);
        }
        state.used += bytes_len;
        state.segments.insert(offset, bytes);
        Ok(())
    }
    pub fn read(
        &self,
        provider: &dyn RangeProvider,
        offset: u64,
        length: u64,
    ) -> Result<Vec<u8>, ReadError> {
        if length == 0 {
            return Ok(vec![]);
        }
        let end = self.end(offset, length)?;
        let mut start = offset / self.segment * self.segment;
        let mut renewed = false;
        let mut output = Vec::with_capacity(length as usize);
        while start < end {
            let wanted = (self.size - start).min(self.segment);
            // Drop the guard before the cache-miss branch: `put` locks this
            // mutex, so holding it across the branch would deadlock every miss.
            let cached = { self.state.lock().unwrap().segments.get(&start).cloned() };
            let bytes = if let Some(cached) = cached {
                cached
            } else {
                let result = match provider.fetch(start, wanted, self.timeout) {
                    Err(ReadError::LeaseExpired) if !renewed => {
                        renewed = true;
                        provider.renew_lease(self.timeout)?;
                        provider.fetch(start, wanted, self.timeout)?
                    }
                    result => result?,
                };
                if result.bytes.len() != wanted as usize {
                    return Err(ReadError::Io);
                }
                let fetched = result.bytes;
                self.put(start, fetched.clone())?;
                fetched
            };
            let from = if start == offset / self.segment * self.segment {
                (offset - start) as usize
            } else {
                0
            };
            let to = ((end - start) as usize).min(bytes.len());
            output.extend_from_slice(&bytes[from..to]);
            start = start.checked_add(self.segment).ok_or(ReadError::Range)?;
        }
        Ok(output)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct P {
        calls: AtomicUsize,
        renewals: AtomicUsize,
    }
    impl RangeProvider for P {
        fn fetch(&self, o: u64, l: u64, _: Duration) -> Result<Segment, ReadError> {
            if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err(ReadError::LeaseExpired);
            }
            Ok(Segment {
                bytes: (o..o + l).map(|x| x as u8).collect(),
            })
        }
        fn renew_lease(&self, _: Duration) -> Result<(), ReadError> {
            self.renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }
    #[test]
    fn eof_and_one_renewal() {
        let p = P {
            calls: AtomicUsize::new(0),
            renewals: AtomicUsize::new(0),
        };
        let c = Cache::new(4, Duration::ZERO, 6, 8);
        assert_eq!(c.read(&p, 4, 2).unwrap(), vec![4, 5]);
        assert_eq!(p.renewals.load(Ordering::SeqCst), 1);
        assert_eq!(c.read(&p, 6, 1), Err(ReadError::Range));
    }
    #[test]
    fn large_read_survives_eviction() {
        let p = P {
            calls: AtomicUsize::new(1),
            renewals: AtomicUsize::new(0),
        };
        let c = Cache::new(4, Duration::ZERO, 12, 4);
        assert_eq!(c.read(&p, 0, 12).unwrap(), (0..12).collect::<Vec<u8>>());
    }
    #[test]
    fn cache_miss_fetches_and_returns_without_relocking_deadlock() {
        let p = P {
            calls: AtomicUsize::new(1),
            renewals: AtomicUsize::new(0),
        };
        let c = Cache::new(4, Duration::ZERO, 4, 4);
        assert_eq!(c.read(&p, 0, 4).unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(p.calls.load(Ordering::SeqCst), 2);
    }
}
