import {
  EPSILON,
  add,
  clamp,
  deterministicOrthogonal,
  distance,
  dot,
  length,
  minimumReach,
  scale,
  subtract,
  unit,
} from "./rigging-ik-math.js";

export function analyticTwoBonePositions({ positions, target, pole, tolerance, handedness }) {
  const [root, middle, tip] = positions;
  const firstLength = distance(root, middle);
  const secondLength = distance(middle, tip);
  const segmentLengths = [firstLength, secondLength];
  const maximumReach = firstLength + secondLength;
  const minimumReachValue = Math.abs(firstLength - secondLength);
  const targetVector = subtract(target, root);
  const targetDistance = length(targetVector);
  if (firstLength <= EPSILON || secondLength <= EPSILON) {
    return {
      ok: false,
      classification: "singular",
      targetDistance,
      minimumReachValue,
      maximumReach,
      message: "Analytic two-bone IK requires two non-zero bone lengths",
    };
  }
  const fallbackDirection = unit(subtract(tip, root), unit(subtract(middle, root)));
  if (targetDistance <= EPSILON && minimumReachValue <= tolerance) {
    return {
      ok: false,
      classification: "singular",
      targetDistance,
      minimumReachValue,
      maximumReach,
      message: "Analytic two-bone target coincides with a zero-minimum-reach root",
    };
  }
  const direction = unit(targetVector, fallbackDirection);
  const solvedDistance = clamp(targetDistance, Math.max(minimumReachValue, EPSILON), maximumReach);
  const unreachable = targetDistance > maximumReach + tolerance || targetDistance < minimumReachValue - tolerance;
  const effectiveTip = add(root, scale(direction, solvedDistance));
  const along = (firstLength * firstLength - secondLength * secondLength + solvedDistance * solvedDistance)
    / (2 * solvedDistance);
  const height = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
  const poleVector = pole ? subtract(pole, root) : subtract(middle, root);
  let bend = subtract(poleVector, scale(direction, dot(poleVector, direction)));
  if (length(bend) <= EPSILON) {
    const currentBend = subtract(subtract(middle, root), scale(direction, dot(subtract(middle, root), direction)));
    bend = length(currentBend) > EPSILON ? currentBend : deterministicOrthogonal(direction, handedness);
  }
  bend = unit(bend, deterministicOrthogonal(direction, handedness));
  const solvedMiddle = add(add(root, scale(direction, along)), scale(bend, height));
  return {
    ok: true,
    positions: [root.slice(), solvedMiddle, effectiveTip],
    iterations: 1,
    classification: unreachable ? "unreachable" : "reachable",
    status: unreachable ? "clamped" : "converged",
    targetDistance,
    finalDistance: distance(effectiveTip, target),
    minimumReachValue,
    maximumReach,
    segmentLengths,
  };
}

export async function fabrikPositions({
  positions: inputPositions,
  target,
  tolerance,
  maximumIterations,
  signal,
  yieldEvery,
  yieldControl,
}) {
  const positions = inputPositions.map((entry) => entry.slice());
  const original = inputPositions.map((entry) => entry.slice());
  const root = positions[0].slice();
  const segmentLengths = [];
  for (let index = 0; index < positions.length - 1; index += 1) {
    const segmentLength = distance(positions[index], positions[index + 1]);
    if (segmentLength <= EPSILON) {
      return {
        ok: false,
        classification: "singular",
        message: `FABRIK chain contains a zero-length segment at ${index}`,
        iterations: 0,
        segmentLengths,
        targetDistance: distance(root, target),
        minimumReachValue: minimumReach(segmentLengths),
        maximumReach: segmentLengths.reduce((sum, entry) => sum + entry, 0),
      };
    }
    segmentLengths.push(segmentLength);
  }
  const maximumReach = segmentLengths.reduce((sum, entry) => sum + entry, 0);
  const minimumReachValue = minimumReach(segmentLengths);
  const targetDistance = distance(root, target);
  const fallbackDirection = unit(subtract(original.at(-1), root), unit(subtract(original[1], root)));
  const direction = unit(subtract(target, root), fallbackDirection);
  const solvedDistance = clamp(targetDistance, minimumReachValue, maximumReach);
  const unreachable = targetDistance > maximumReach + tolerance || targetDistance < minimumReachValue - tolerance;
  const effectiveTarget = add(root, scale(direction, solvedDistance));
  if (targetDistance > maximumReach + tolerance) {
    positions[0] = root;
    for (let index = 0; index < segmentLengths.length; index += 1) {
      positions[index + 1] = add(positions[index], scale(direction, segmentLengths[index]));
    }
    return {
      ok: true,
      positions,
      iterations: 1,
      classification: "unreachable",
      status: "clamped",
      targetDistance,
      finalDistance: distance(positions.at(-1), target),
      minimumReachValue,
      maximumReach,
      segmentLengths,
    };
  }
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    if (signal?.aborted) {
      return {
        ok: false,
        classification: "cancelled",
        message: "Rig IK request was cancelled",
        iterations: iteration - 1,
        segmentLengths,
        targetDistance,
        minimumReachValue,
        maximumReach,
      };
    }
    positions[positions.length - 1] = effectiveTarget.slice();
    for (let index = positions.length - 2; index >= 0; index -= 1) {
      const directionToPrevious = unit(
        subtract(positions[index], positions[index + 1]),
        subtract(original[index], original[index + 1]),
      );
      positions[index] = add(positions[index + 1], scale(directionToPrevious, segmentLengths[index]));
    }
    positions[0] = root.slice();
    for (let index = 0; index < positions.length - 1; index += 1) {
      const directionToNext = unit(
        subtract(positions[index + 1], positions[index]),
        subtract(original[index + 1], original[index]),
      );
      positions[index + 1] = add(positions[index], scale(directionToNext, segmentLengths[index]));
    }
    const error = distance(positions.at(-1), effectiveTarget);
    if (iteration % yieldEvery === 0) {
      await yieldControl();
      if (signal?.aborted) {
        return {
          ok: false,
          classification: "cancelled",
          message: "Rig IK request was cancelled",
          iterations: iteration,
          segmentLengths,
          targetDistance,
          finalDistance: distance(positions.at(-1), target),
          minimumReachValue,
          maximumReach,
        };
      }
    }
    if (error <= tolerance) {
      return {
        ok: true,
        positions,
        iterations: iteration,
        classification: unreachable ? "unreachable" : "reachable",
        status: unreachable ? "clamped" : "converged",
        targetDistance,
        finalDistance: distance(positions.at(-1), target),
        minimumReachValue,
        maximumReach,
        segmentLengths,
      };
    }
  }
  return {
    ok: false,
    classification: "iteration-exhausted",
    message: `FABRIK did not converge within ${maximumIterations} iterations`,
    iterations: maximumIterations,
    segmentLengths,
    targetDistance,
    finalDistance: distance(positions.at(-1), target),
    minimumReachValue,
    maximumReach,
  };
}
