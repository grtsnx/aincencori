import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { checkSchedule } from '@/modules/routine/routine.service.js';

describe('routine schedules', () => {
  it('accepts a daily or weekday schedule in a real time zone', () => {
    expect(() => checkSchedule('0 8 * * *', 'Africa/Lagos')).not.toThrow();
    expect(() => checkSchedule('30 7 * * 1-5', 'Europe/London')).not.toThrow();
  });

  it('refuses bad patterns, unknown time zones and runs too close together', () => {
    expect(() => checkSchedule('not a cron', 'UTC')).toThrow(
      BadRequestException,
    );
    expect(() => checkSchedule('0 8 * * *', 'Mars/Olympus')).toThrow(
      'Unknown time zone.',
    );
    expect(() => checkSchedule('*/5 * * * *', 'UTC')).toThrow('at most every');
  });
});
