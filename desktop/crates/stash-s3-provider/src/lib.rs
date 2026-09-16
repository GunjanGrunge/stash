use stash_core::{RangeProvider, ReadError, Segment};
use std::{io::Read, sync::Mutex, time::Duration};
pub trait LeaseSource: Send + Sync {
    fn current_url(&self) -> Result<String, ReadError>;
    fn renew(&self) -> Result<String, ReadError>;
}
pub struct HttpRangeProvider<L: LeaseSource> {
    lease: L,
    url: Mutex<Option<String>>,
    agent: ureq::Agent,
}
impl<L: LeaseSource> HttpRangeProvider<L> {
    pub fn new(lease: L) -> Self {
        Self {
            lease,
            url: Mutex::new(None),
            agent: ureq::AgentBuilder::new().build(),
        }
    }
    fn url(&self) -> Result<String, ReadError> {
        let mut u = self.url.lock().unwrap();
        if let Some(v) = u.as_ref() {
            return Ok(v.clone());
        }
        let v = self.lease.current_url()?;
        *u = Some(v.clone());
        Ok(v)
    }
    fn get(&self, url: &str, o: u64, l: u64, t: Duration) -> Result<Vec<u8>, ReadError> {
        let end = o
            .checked_add(l)
            .and_then(|x| x.checked_sub(1))
            .ok_or(ReadError::Range)?;
        match self
            .agent
            .get(url)
            .timeout(t)
            .set("Range", &format!("bytes={o}-{end}"))
            .call()
        {
            Ok(r) if r.status() == 206 => {
                if !r
                    .header("Content-Range")
                    .is_some_and(|h| h.starts_with(&format!("bytes {o}-{end}/")))
                {
                    return Err(ReadError::Range);
                }
                let mut b = vec![];
                r.into_reader()
                    .take(l)
                    .read_to_end(&mut b)
                    .map_err(|_| ReadError::Io)?;
                if b.len() == l as usize {
                    Ok(b)
                } else {
                    Err(ReadError::Io)
                }
            }
            Ok(_) => Err(ReadError::Range),
            Err(ureq::Error::Status(403, _)) | Err(ureq::Error::Status(404, _)) => {
                Err(ReadError::LeaseExpired)
            }
            Err(_) => Err(ReadError::Offline),
        }
    }
}
impl<L: LeaseSource> RangeProvider for HttpRangeProvider<L> {
    fn fetch(&self, o: u64, l: u64, t: Duration) -> Result<Segment, ReadError> {
        Ok(Segment {
            bytes: self.get(&self.url()?, o, l, t)?,
        })
    }
    fn renew_lease(&self, _: Duration) -> Result<(), ReadError> {
        let v = self.lease.renew()?;
        *self.url.lock().unwrap() = Some(v);
        Ok(())
    }
}
