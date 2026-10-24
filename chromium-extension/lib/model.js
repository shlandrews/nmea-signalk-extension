export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const coordinates = (lat, lon) => finite(lat) && Math.abs(lat) <= 90 && finite(lon) && Math.abs(lon) <= 180;
export const clock = {wall: () => Date.now(), mono: () => performance.now()};
const optional = ['altitude', 'speed', 'course', 'hdop', 'quality', 'gpsTime'];

export class GPS {
  constructor(config, time = clock) { this.config = config; this.time = time; this.reset(); }
  reset() {
    this.values = {latitude:null, longitude:null, altitude:null, speed:null, course:null, hdop:null, quality:null, gpsTime:null};
    this.times = {}; this.received = null; this.timestamp = null; this.valid = false;
    this.connection = 'connecting'; this.sourceAddress = null; this.pgns = new Set(); this.lastReceived = null;
    this.dirty = true;
  }
  update(fields) {
    const now = this.time.mono(), wall = this.time.wall();
    this.dirty = true;
    this.lastReceived = wall;
    // Auxiliary quality can invalidate a position, but cannot freshen or repair
    // one. Recovery always requires a newly validated coordinate update.
    if ('valid' in fields && fields.valid !== true) this.valid = false;
    for (const key of Object.keys(this.values)) {
      if (!(key in fields)) continue;
      let value = fields[key];
      if (!['quality','gpsTime'].includes(key)) {
        value = finite(value) ? value : null;
        if (['speed','hdop'].includes(key) && value < 0) value = null;
        if (key === 'course' && value !== null && (value < 0 || value >= 360)) value = null;
      } else if (key === 'gpsTime') value = typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
      else value = (typeof value === 'string' && value.length < 80) || finite(value) ? value : null;
      this.values[key] = value; this.times[key] = now;
    }
    if ('latitude' in fields || 'longitude' in fields) {
      this.valid = fields.valid !== false && coordinates(this.values.latitude, this.values.longitude);
      let age = 0;
      if (fields.gpsTime) age = wall - Date.parse(fields.gpsTime);
      if (!finite(age) || age > this.config.stale * 1000 || age < -30000) this.valid = false;
      this.received = now; this.timestamp = wall;
    }
  }
  snapshot() {
    const now = this.time.mono(), age = this.received === null ? null : Math.max(0, (now - this.received) / 1000);
    const values = {...this.values};
    for (const key of optional) if (now - (this.times[key] ?? -Infinity) > this.config.stale * 1000) values[key] = null;
    const estimated = finite(values.hdop) && values.hdop > 0;
    let status = this.connection;
    if (status === 'connected') status = age !== null && age > this.config.stale ? 'stale' : (age !== null && this.valid ? 'fix' : 'no-fix');
    return {type:'gps',version:1,...values,valid:!!this.valid,status,timestamp:this.timestamp,age,
      accuracy:estimated ? values.hdop * this.config.uere : this.config.accuracy,
      accuracyKind:estimated ? 'hdop-estimate' : 'configured-estimate',altitudeAccuracy:null,
      source:this.config.source,sourceAddress:this.sourceAddress,pgns:[...this.pgns].sort((a,b)=>a-b),
      selectedPgns:this.config.pgns,lastReceived:this.lastReceived};
  }
}
