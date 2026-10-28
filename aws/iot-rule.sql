SELECT *, clientid() AS clientid FROM 'devices/+/+' WHERE topic(3) = 'telemetry' OR topic(3) = 'faults'
