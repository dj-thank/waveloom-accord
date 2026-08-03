import * as THREE_DEFAULT from 'three';
import {
  createKagariaiRoofRibModel,
  disposeKagariaiRoofRibModel,
} from './createKagariaiRoofRibModel.js';
import {
  KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE,
  assertKagariaiRoofRibReviewAdmission,
  assertKagariaiRoofRibRuntimeAdmission,
} from './runtimeAdmissionCandidate.js';

const SUPPORT_CONTACT_OFFSET_M = 0.07;

function buildKagariaiRoofRibGroup(options, admission, reviewOnly) {
  const THREE = options.THREE ?? THREE_DEFAULT;
  const group = new THREE.Group();
  group.name = reviewOnly ? 'kagariai_roof_rib_map_review_group' : 'kagariai_roof_rib_runtime_group';
  group.userData.collision = false;
  group.userData.reviewOnly = reviewOnly;
  group.userData.runtimeAdmissionId = admission.assetId;
  group.userData.performanceWorstCase = { ...admission.aggregateWorstCaseBudget };
  group.userData.runtimeModels = [];

  try {
    for (const placement of admission.placements) {
      const slot = new THREE.Group();
      slot.name = placement.id;
      slot.position.fromArray(placement.position);
      slot.rotation.set(...placement.rotation);
      slot.scale.fromArray(placement.scale);
      slot.userData.collision = false;
      slot.userData.semantics = placement.semantics;
      slot.userData.support = placement.support;

      const model = createKagariaiRoofRibModel({
        THREE,
        pbrTextures: options.pbrTextures,
        ownsPbrTextures: false,
        finial: placement.finial,
        castShadow: options.castShadow,
        receiveShadow: options.receiveShadow,
      });
      // The procedural look-dev factory is Y-up. Kagariai map transforms are
      // Z-up, so map the model's local +Y axis onto world +Z explicitly.
      model.rotation.x = Math.PI / 2;
      // The authored tile shell starts 0.07 m above its factory origin. Embed
      // that construction offset so the installed visual touches the support
      // roof instead of floating above it.
      model.position.z = -SUPPORT_CONTACT_OFFSET_M;
      model.userData.assetModel.candidateOnly = reviewOnly;
      model.userData.assetModel.reviewOnly = reviewOnly;
      model.userData.assetModel.runtimeAdmissionId = admission.assetId;
      model.userData.assetModel.supportFit = {
        mode: 'support-contact',
        verticalOffsetM: -SUPPORT_CONTACT_OFFSET_M,
        clearanceM: 0,
      };
      slot.add(model);
      group.userData.runtimeModels.push(model);
      group.add(slot);
    }
  } catch (error) {
    for (const model of group.userData.runtimeModels) disposeKagariaiRoofRibModel(model);
    group.clear();
    group.userData.runtimeModels = [];
    throw error;
  }
  return group;
}

export function createKagariaiRoofRibRuntimeGroup(options = {}) {
  const admission = options.admission ?? KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE;
  assertKagariaiRoofRibRuntimeAdmission(admission);
  return buildKagariaiRoofRibGroup(options, admission, false);
}

export function createKagariaiRoofRibMapReviewGroup(options = {}) {
  const admission = options.admission;
  assertKagariaiRoofRibReviewAdmission(admission);
  return buildKagariaiRoofRibGroup(options, admission, true);
}

export function disposeKagariaiRoofRibRuntimeGroup(group) {
  if (!group?.isObject3D) throw new Error('ROOF_RIB_RUNTIME_GROUP_INVALID');
  if (group.userData.disposed === true) return false;
  for (const model of group.userData.runtimeModels || []) disposeKagariaiRoofRibModel(model);
  group.clear();
  group.userData.runtimeModels = [];
  group.userData.disposed = true;
  return true;
}
