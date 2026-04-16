import { v4 as uuid } from 'uuid';

export type UUID = string

export const UUID = {
  random(): UUID {
    return uuid();
  }
}