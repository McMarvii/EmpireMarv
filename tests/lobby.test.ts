import { describe, expect, it } from 'vitest';
import { delayFor, lobbyProblem, matchSettings, MAX_DELAY, MIN_DELAY, parseInvite, PLAYER_COLORS, type LobbySlot, type MatchOptions } from '../src/net/protocol';
import { codec } from '../src/net/rtc';

const OPTIONS: MatchOptions = {
  mapSize: 96,
  difficulty: 'hard',
  startEpoch: 2,
  maxEpoch: 1,
  popLimit: 200,
  startResources: 'low',
  reveal: true,
  seed: 0,
};

const slot = (kind: LobbySlot['kind'], team: number, name = ''): LobbySlot => ({ kind, team, name, color: PLAYER_COLORS[team - 1] });

describe('lobby rules', () => {
  it('needs two players in two teams', () => {
    expect(lobbyProblem([slot('host', 1, 'A'), slot('open', 2), slot('closed', 3), slot('closed', 4)])).toMatch(/zwei Spieler/);
    expect(lobbyProblem([slot('host', 1, 'A'), slot('ai', 1, 'KI'), slot('closed', 3), slot('closed', 4)])).toMatch(/zwei Teams/);
    expect(lobbyProblem([slot('host', 1, 'A'), slot('human', 2, 'B'), slot('closed', 3), slot('closed', 4)])).toBeNull();
  });

  it('turns slots into players, skipping empty ones, with a fixed random seed', () => {
    const { settings, playerOf } = matchSettings([slot('host', 1, 'A'), slot('open', 2), slot('ai', 2, 'KI'), slot('human', 1, 'B')], OPTIONS);
    expect(playerOf).toEqual([0, -1, 1, 2]);
    expect(settings.players.map((p) => [p.name, p.isAI, p.team])).toEqual([
      ['A', false, 1],
      ['KI', true, 2],
      ['B', false, 1],
    ]);
    expect(settings.seed).toBeGreaterThan(0);
    expect(settings.maxEpoch).toBe(2);
    expect(settings.aiDifficulty).toBe('hard');
    expect(settings.revealMap).toBe(true);
  });

  it('picks an input delay from the round trip', () => {
    expect(delayFor(0)).toBe(MIN_DELAY);
    expect(delayFor(150)).toBe(3);
    expect(delayFor(5000)).toBe(MAX_DELAY);
  });
});

describe('invitations', () => {
  it('reads links, ids and codes', () => {
    expect(parseInvite('https://mcmarvii.github.io/EmpireMarv/#join=em-ab3k9xyz')).toEqual({ room: 'em-ab3k9xyz' });
    expect(parseInvite(' em-ab3k9xyz ')).toEqual({ room: 'em-ab3k9xyz' });
    expect(parseInvite('http://localhost:5173/?signal=local#code=EM1.abc-_x')).toEqual({ code: 'EM1.abc-_x' });
    expect(parseInvite('EM1.abc')).toEqual({ code: 'EM1.abc' });
    expect(parseInvite('irgendwas')).toBeNull();
  });

  it('packs a handshake into a short code and back', async () => {
    const sdp = 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n' + 'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0\r\n'.repeat(4);
    const code = await codec.squeeze(sdp);
    expect(code.startsWith('EM1.')).toBe(true);
    expect(code).toMatch(/^EM1\.[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(sdp.length);
    expect(await codec.unsqueeze(`  ${code}\n`)).toBe(sdp);
    await expect(codec.unsqueeze('EM1.kaputt')).rejects.toThrow(/beschädigt/);
    await expect(codec.unsqueeze('hallo')).rejects.toThrow(/kein gültiger Code/);
  });
});
