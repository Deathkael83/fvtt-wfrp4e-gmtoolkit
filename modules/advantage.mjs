import GMToolkit from "./gm-toolkit.mjs"
import { inActiveCombat } from "./utility.mjs"

export default class Advantage {

  /**
   * Entry point for adjustments to Advantage.
   * @param {Object} character   : Token
   * @param {string|number} adjustment : increase (+1), clear (=0), reduce (-1), oppure delta numerico (+N / -N)
   * @param {string} context     : macro, wfrp4e:opposedTestResult, wfrp4e:applyDamage, createCombatant, preDeleteCombatant, createActiveEffect, loseMomentum, opposedLedger, dualWieldConsume
   * @returns {Array} update     : outcome (String), starting (Number), new (Number)
   **/
  static async update (character, adjustment, context = "macro") {
    if (adjustment === null || adjustment === undefined) return

    if (
      (character === undefined)
      || (character?.document?.documentName !== "Token")
      || (context === "macro" && canvas.tokens.controlled.length !== 1)
    ) {
      return ui.notifications.error(game.i18n.localize("GMTOOLKIT.Token.SingleSelect"), { console: true })
    }

    const isNumericAdjustment = Number.isInteger(adjustment)

    // Not in combat, unless clearing or applying a negative/zero numeric correction
    if (!character.inCombat && adjustment !== "clear" && !(isNumericAdjustment && adjustment <= 0)) {
      return ui.notifications.error(
        `${game.i18n.format("GMTOOLKIT.Advantage.NotInCombat", {
          actorName: character.name,
          sceneName: game.scenes.viewed.name
        })}`,
        { console: true }
      )
    }

    const characterInfo = { name: character.name }
    characterInfo.advantage = {
      personal: {
        current: Number(character.actor.status.advantage.value ?? 0),
        max: character.actor.status.advantage.max
      },
      group: {
        affiliation: character.actor.advantageGroup,
        current: await game.settings.get("wfrp4e", "groupAdvantageValues")[character.actor.advantageGroup]
      }
    }

    GMToolkit.log(false, characterInfo)

    const updatedAdvantage = await this.adjust(
      character,
      characterInfo.advantage.personal,
      adjustment
    )

    const update = await this.report(
      updatedAdvantage,
      character,
      characterInfo.advantage.personal,
      context
    )

    update.outcome = updatedAdvantage.outcome
    update.new = updatedAdvantage.new
    update.starting = updatedAdvantage.starting
    GMToolkit.log(false, update)
    return update
  }

  static async adjust (character, advantage, adjustment) {
    GMToolkit.log(false, `Attempting to adjust Advantage for ${character.name} from ${advantage.current} with`, adjustment)

    const starting = Number(advantage.current ?? 0)
    let outcome = ""
    let newValue = starting

    const usingGroupAdvantage = game.settings.get("wfrp4e", "useGroupAdvantage")
    const maxValue = advantage.max

    // Numeric delta support
    if (Number.isInteger(adjustment)) {
      let target = starting + adjustment

      if (target < 0) target = 0
      if (!usingGroupAdvantage && maxValue !== undefined && target > maxValue) target = maxValue

      if (target === starting) {
        if (adjustment > 0 && !usingGroupAdvantage && maxValue !== undefined && starting >= maxValue) {
          outcome = "max"
        } else if (adjustment < 0 && starting <= 0) {
          outcome = "min"
        } else {
          outcome = "nochange"
        }
      } else {
        newValue = Number(target)
        const updated = await updateCharacterAdvantage(newValue)

        if (!updated) {
          outcome = "nochange"
        } else if (newValue === 0 && starting > 0) {
          outcome = "reset"
        } else if (newValue > starting) {
          outcome = "increased"
        } else {
          outcome = "reduced"
        }
      }

      return {
        outcome,
        starting,
        new: newValue
      }
    }

    // Legacy string adjustments
    switch (adjustment) {
      case "increase":
        if (usingGroupAdvantage || maxValue === undefined || starting < maxValue) {
          newValue = Number(starting + 1)
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "increased" : "nochange"
        } else {
          outcome = "max"
        }
        break

      case "reduce":
        if (starting > 0) {
          newValue = Number(starting - 1)
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "reduced" : "nochange"
        } else {
          outcome = "min"
        }
        break

      case "clear":
        if (starting === 0) {
          outcome = "min"
        } else {
          newValue = 0
          const updated = await updateCharacterAdvantage(newValue)
          outcome = updated ? "reset" : "nochange"
        }
        break

      default:
        outcome = "nochange"
        break
    }

    return {
      outcome,
      starting,
      new: newValue
    }

    async function updateCharacterAdvantage (value) {
      let updated = ""

      if (!character.actor.isOwner) {
        return updated = await game.socket.emit(
          `module.${GMToolkit.MODULE_ID}`,
          {
            type: "updateAdvantage",
            payload: {
              character: character.actor.id,
              updateData: { "system.status.advantage.value": value }
            }
          }
        )
      } else {
        return updated = await character.actor.update({ "system.status.advantage.value": value })
      }
    }
  }

  static async report (updatedAdvantage, character, resourceBase, context) {
    const update = []
    let type = "success"
    const options = {
      permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"),
      console: true
    }

    switch (context) {
      case "wfrp4e:opposedTestResult":
        if (updatedAdvantage.outcome === "increased") update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.WonOpposedTest", { actorName: character.name })
        if (updatedAdvantage.outcome === "reset") update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.LostOpposedTest", { actorName: character.name })
        break
      case "loseMomentum":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.LoseMomentum", { actorName: character.name })
        break
      case "createCombatant":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.AddedToCombat", { actorName: character.name })
        break
      case "preDeleteCombatant":
      case "deleteCombatant":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.RemovedFromCombat", { actorName: character.name })
        break
      case "dualWieldConsume":
        update.context = game.i18n.format("GMTOOLKIT.Advantage.Context.WonOpposedTest", { actorName: character.name })
        break
      default:
        break
    }

    switch (updatedAdvantage.outcome) {
      case "increased":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Increased", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, newAdvantage: updatedAdvantage.new })
        break
      case "reduced":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Reduced", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, newAdvantage: updatedAdvantage.new })
        break
      case "reset":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Reset", { actorName: character.name, startingAdvantage: updatedAdvantage.starting })
        break
      case "min":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.None", { actorName: character.name, startingAdvantage: updatedAdvantage.starting })
        type = "info"
        break
      case "max":
        update.notice = game.i18n.format("GMTOOLKIT.Advantage.Max", { actorName: character.name, startingAdvantage: updatedAdvantage.starting, maxAdvantage: resourceBase.max })
        type = "info"
        break
      case "nochange":
      default:
        update.notice = game.i18n.format("GMTOOLKIT.Message.UnexpectedNoChange")
        type = "warning"
        break
    }

    const message = (update.context ? update.context : "") + update.notice
    // Bypass individual player Advantage updates if Group Advantage is being used
    if (game.user.isGM && !(game.settings.get("wfrp4e", "useGroupAdvantage"))) ui.notifications.notify(message, type, options)
    // Force refresh the token hud if it is visible
    if (character.hasActiveHUD) { await canvas.hud.token.render(true) }
    update.context = (update.context) ? update.context : context
    return update
  }

  /**
   * Clears combatant flags set for increasing token Advantage during combat.
   * @param {Array} advantaged   :   Array of Combatant
   * @param {boolean} startOfRound  :   Unset sorAdvantage flag at end of round
   **/
  static unsetFlags (advantaged, startOfRound = false) {
    advantaged.filter(c => c.unsetFlag(GMToolkit.MODULE_ID, "advantage"))
    if (startOfRound) advantaged.filter(c => c.unsetFlag(GMToolkit.MODULE_ID, "sorAdvantage"))
    GMToolkit.log(false, "Advantage Flags: Unset.")
  }

  static async loseMomentum (combat) {
    GMToolkit.log(false, "Lose Momentum at End of Round: Started.")
    const round = combat.round
    let checkGained = ""
    let checkNotGained = ""
    let noAdvantage = ""
    let combatantLine = ""

    combat.combatants.forEach(combatant => {
      const endOfRound = Number(combatant.token?.actor?.system?.status?.advantage?.value ?? 0)
      const sorFlag = combatant.getFlag(GMToolkit.MODULE_ID, "sorAdvantage")
      const startOfRound = Number.isFinite(Number(sorFlag)) ? Number(sorFlag) : 0

      const gainedThisRound = endOfRound > startOfRound
      const checkToLoseMomentum = gainedThisRound ? false : "checked"

      // TODO: Define and replace the inline styles within the stylesheet
      if (endOfRound <= 0) {
        noAdvantage += `<img src="${combatant.img}" style = "height: 2rem; border: none; padding-right: 2px; padding-left: 2px; max-width: fit-content;" alt="${combatant.name}" title="${combatant.name}">&nbsp;${combatant.name}</img>`
      } else {
        combatantLine = `
                <div class="form-group">
                <input type="checkbox" id="${combatant.tokenId}" name="${combatant.tokenId}" value="${combatant.name}" ${checkToLoseMomentum}> 
                <img src="${combatant.img}" style = "height: 2rem; vertical-align : middle; border: none; padding-right: 6px; padding-left: 2px; max-width: fit-content;" />
                <label for="${combatant.tokenId}" style = "text-align: left; border: none;"> <strong>${combatant.name}</strong></label>
                <label for="${combatant.tokenId}" style = "text-align: left; border: none;"> ${startOfRound} &rarr; ${endOfRound} </label>
                </div>
                `
        if (gainedThisRound) {
          checkGained += combatantLine
        } else {
          checkNotGained += combatantLine
        }
      }
    })

    const templateData = {
      gained: checkGained,
      notgained: checkNotGained,
      none: noAdvantage
    }
    const dialogContent = await renderTemplate("modules/wfrp4e-gm-toolkit-dk-fix/templates/gm-toolkit-advantage-momentum.html", templateData)
    let lostAdvantage = ""

    foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format("GMTOOLKIT.Dialog.Advantage.LoseMomentum.Title", { combatRound: round }) },
      rejectClose: false,
      content: dialogContent,
      buttons: [
        {
          label: game.i18n.localize("GMTOOLKIT.Dialog.Advantage.LoseMomentum.Button"),
          action: "reduceAdvantage",
          callback: async (event, button, dialog) => {
            const response = new foundry.applications.ux
              .FormDataExtended(button.form).object

            // Reduce advantage for selected combatants
            for (const combatant of combat.combatants) {
              if (response[combatant.tokenId] === combatant.name) {
                const token = canvas.tokens.placeables
                  .filter(a => a.id === combatant.tokenId)[0]
                const result = await this.update(token, "reduce", "loseMomentum")
                lostAdvantage += `${token.name}: ${result.starting} &rarr; ${result.new} <br/>`
              }
            }

            // Confirm changes made in whisper to GM
            if (lostAdvantage !== "") {
              const chatData = game.wfrp4e.utility.chatDataSetup(lostAdvantage, "gmroll", false)
              chatData.flavor = game.i18n.format("GMTOOLKIT.Message.Advantage.LostMomentum", { combatRound: round })
              ChatMessage.create(chatData, {})
            }
          }
        },
        {
          label: game.i18n.localize("GMTOOLKIT.Dialog.Cancel"),
          action: "cancel"
        }
      ]
    })

    GMToolkit.log(false, "Lose Momentum at End of Round: Finished.")
  }
}

async function getOpposedLedger () {
  const combat = game.combats.active
  if (!combat) return {}
  return foundry.utils.deepClone(combat.getFlag(GMToolkit.MODULE_ID, "opposedLedger") ?? {})
}

async function setOpposedLedger (ledger) {
  const combat = game.combats.active
  if (!combat) return
  return combat.setFlag(GMToolkit.MODULE_ID, "opposedLedger", ledger)
}

async function getDualWieldLedger () {
  const combat = game.combats.active
  if (!combat) return {}
  return foundry.utils.deepClone(combat.getFlag(GMToolkit.MODULE_ID, "dualWieldLedger") ?? {})
}

async function setDualWieldLedger (ledger) {
  const combat = game.combats.active
  if (!combat) return
  return combat.setFlag(GMToolkit.MODULE_ID, "dualWieldLedger", ledger)
}

function getCombatantTokenUuid (combatant) {
  if (!combatant) return null
  return combatant.token?.uuid ?? combatant.token?.document?.uuid ?? combatant.token?.object?.document?.uuid ?? null
}

function getCombatantSceneId (combatant) {
  return combatant?.token?.parent?.id ?? combatant?.parent?.scene?.id ?? game.scenes.current?.id ?? null
}

function getTokenDocumentFromRef (ref = {}) {
  const sceneId = ref.sceneId ?? game.scenes.current?.id ?? null
  const tokenId = ref.tokenId ?? null
  if (!tokenId) return null

  const scene = sceneId ? game.scenes.get(sceneId) : game.scenes.current
  return scene?.tokens?.get(tokenId)
    ?? canvas.tokens.placeables.find(t => t.id === tokenId)?.document
    ?? null
}

function getTokenObjectFromRef (ref = {}) {
  const tokenDoc = getTokenDocumentFromRef(ref)
  return tokenDoc?.object
    ?? canvas.tokens.placeables.find(t => t.id === ref.tokenId)
    ?? null
}

function getTokenRefFromCombatant (combatant) {
  if (!combatant) return null

  const tokenId = combatant.tokenId ?? combatant.token?.id ?? combatant.token?.document?.id ?? null
  if (!tokenId) return null

  return {
    actorId: combatant.actor?.id ?? null,
    combatantId: combatant.id ?? null,
    tokenId,
    sceneId: getCombatantSceneId(combatant),
    tokenUuid: getCombatantTokenUuid(combatant)
  }
}

function getCombatantByTokenRef (tokenRef) {
  const combat = game.combats.active
  if (!combat || !tokenRef) return null

  if (tokenRef.combatantId) {
    const byCombatantId = combat.combatants.get(tokenRef.combatantId)
    if (byCombatantId) return byCombatantId
  }

  if (tokenRef.tokenId) {
    const byTokenId = Array.from(combat.combatants).find(c => c.tokenId === tokenRef.tokenId)
    if (byTokenId) return byTokenId
  }

  if (tokenRef.tokenUuid) {
    const byTokenUuid = Array.from(combat.combatants).find(c => getCombatantTokenUuid(c) === tokenRef.tokenUuid)
    if (byTokenUuid) return byTokenUuid
  }

  if (tokenRef.actorId) {
    const actorMatches = Array.from(combat.combatants).filter(c => c.actor?.id === tokenRef.actorId)
    if (actorMatches.length === 1) return actorMatches[0]
  }

  return null
}

function getTokenObjectForCombatant (combatant) {
  if (!combatant) return null

  const tokenRef = getTokenRefFromCombatant(combatant)
  return getTokenObjectFromRef(tokenRef)
    ?? combatant.token?.object
    ?? canvas.tokens.placeables.find(t => t.id === combatant.tokenId)
    ?? null
}

function getTokenRefFromTest (test, fallbackActor = null) {
  if (!test && !fallbackActor) return null

  const actor = test?.actor ?? fallbackActor ?? null
  const speaker = test?.message?.speaker ?? null
  const sceneId = speaker?.scene ?? game.combats.active?.scene?.id ?? game.scenes.current?.id ?? null
  const speakerTokenId = speaker?.token ?? null

  const directRef = speakerTokenId
    ? {
        actorId: actor?.id ?? null,
        combatantId: test?.combatant?.id ?? null,
        tokenId: speakerTokenId,
        sceneId,
        tokenUuid: null
      }
    : null

  if (directRef?.tokenId) {
    const combatant = getCombatantByTokenRef(directRef)
    if (combatant) {
      return {
        ...directRef,
        combatantId: directRef.combatantId ?? combatant.id ?? null,
        tokenUuid: getCombatantTokenUuid(combatant) ?? null
      }
    }

    const tokenDoc = getTokenDocumentFromRef(directRef)
    if (tokenDoc) {
      return {
        ...directRef,
        tokenUuid: tokenDoc.uuid ?? null
      }
    }
  }

  if (test?.combatant) {
    const combatantRef = getTokenRefFromCombatant(test.combatant)
    if (combatantRef) return combatantRef
  }

  if (actor) {
    const actorMatches = Array.from(game.combats.active?.combatants ?? []).filter(c => c.actor?.id === actor.id)
    if (actorMatches.length === 1) return getTokenRefFromCombatant(actorMatches[0])
  }

  return directRef
}

function getOpposedMessageId (opposedTest, attackerTest, defenderTest) {
  const attackerMessageId =
    opposedTest?.attackerTest?.message?.id
    ?? attackerTest?.message?.id
    ?? "no-attacker-message"

  const defenderMessageId =
    opposedTest?.defenderTest?.message?.id
    ?? defenderTest?.message?.id
    ?? "no-defender-message"

  const attackerRef = getTokenRefFromTest(attackerTest, opposedTest?.attacker)
  const defenderRef = getTokenRefFromTest(defenderTest, opposedTest?.defender)

  const attackerKey =
    attackerRef?.combatantId
    ?? attackerRef?.tokenUuid
    ?? attackerRef?.tokenId
    ?? attackerRef?.actorId
    ?? opposedTest?.attacker?.id
    ?? attackerTest?.actor?.id
    ?? "no-attacker-ref"

  const defenderKey =
    defenderRef?.combatantId
    ?? defenderRef?.tokenUuid
    ?? defenderRef?.tokenId
    ?? defenderRef?.actorId
    ?? opposedTest?.defender?.id
    ?? defenderTest?.actor?.id
    ?? "no-defender-ref"

  return `${attackerMessageId}__${defenderMessageId}__${attackerKey}__${defenderKey}`
}

function resolveOpposedLedgerKey ({
  ledger,
  rawMessageId,
  attackerRef,
  defenderRef
}) {
  const combat = game.combats.active
  const round = combat?.round ?? null
  const turn = combat?.turn ?? null

  if (ledger[rawMessageId]) return rawMessageId

  const attackerMatchKey =
    attackerRef?.combatantId
    ?? attackerRef?.tokenUuid
    ?? attackerRef?.tokenId
    ?? attackerRef?.actorId
    ?? null

  const defenderMatchKey =
    defenderRef?.combatantId
    ?? defenderRef?.tokenUuid
    ?? defenderRef?.tokenId
    ?? defenderRef?.actorId
    ?? null

  const candidates = Object.entries(ledger)
    .filter(([, entry]) => {
      const entryAttackerKey =
        entry?.attackerRef?.combatantId
        ?? entry?.attackerRef?.tokenUuid
        ?? entry?.attackerRef?.tokenId
        ?? entry?.attackerActorId
        ?? null

      const entryDefenderKey =
        entry?.defenderRef?.combatantId
        ?? entry?.defenderRef?.tokenUuid
        ?? entry?.defenderRef?.tokenId
        ?? entry?.defenderActorId
        ?? null

      return entryAttackerKey === attackerMatchKey
        && entryDefenderKey === defenderMatchKey
        && entry?.round === round
        && entry?.turn === turn
    })
    .sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0))

  if (candidates.length > 0) {
    return candidates[0][0]
  }

  return rawMessageId
}

function getDualWieldKey (tokenRef, round = game.combats.active?.round ?? null, turn = game.combats.active?.turn ?? null) {
  const tokenKey =
    tokenRef?.combatantId
    ?? tokenRef?.tokenUuid
    ?? tokenRef?.tokenId
    ?? tokenRef?.actorId
    ?? "no-token-ref"

  return `${round}__${turn}__${tokenKey}`
}

async function setDualWieldOpeningAdvantage ({
  attackerRef,
  sourceMessageId
}) {
  const combat = game.combats.active
  if (!combat || !attackerRef) return

  const ledger = await getDualWieldLedger()
  const key = getDualWieldKey(attackerRef, combat.round, combat.turn)

  ledger[key] = {
    attackerRef: foundry.utils.deepClone(attackerRef),
    round: combat.round ?? null,
    turn: combat.turn ?? null,
    sourceMessageId: sourceMessageId ?? null,
    consumed: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  await setDualWieldLedger(ledger)
  GMToolkit.log(true, "Dual Wield opening advantage stored.", ledger[key])
}

async function findDualWieldOpeningAdvantage ({
  attackerRef = null,
  sourceMessageId = null
} = {}) {
  const ledger = await getDualWieldLedger()
  const combat = game.combats.active
  if (!combat) return { key: null, entry: null }

  const attackerMatchKey =
    attackerRef?.combatantId
    ?? attackerRef?.tokenUuid
    ?? attackerRef?.tokenId
    ?? attackerRef?.actorId
    ?? null

  // 1) Match principale: attackerRef nel turno corrente
  if (attackerMatchKey) {
    const candidates = Object.entries(ledger)
      .filter(([, entry]) => {
        const entryAttackerKey =
          entry?.attackerRef?.combatantId
          ?? entry?.attackerRef?.tokenUuid
          ?? entry?.attackerRef?.tokenId
          ?? entry?.attackerRef?.actorId
          ?? null

        return entryAttackerKey === attackerMatchKey
          && entry?.round === (combat.round ?? null)
          && entry?.turn === (combat.turn ?? null)
          && !entry?.consumed
      })
      .sort((a, b) => (b[1]?.updatedAt ?? b[1]?.createdAt ?? 0) - (a[1]?.updatedAt ?? a[1]?.createdAt ?? 0))

    if (candidates.length > 0) {
      return { key: candidates[0][0], entry: candidates[0][1] }
    }
  }

  // 2) Fallback secondario: messageId, solo se disponibile
  if (sourceMessageId) {
    const candidates = Object.entries(ledger)
      .filter(([, entry]) => entry?.sourceMessageId === sourceMessageId && !entry?.consumed)
      .sort((a, b) => (b[1]?.updatedAt ?? b[1]?.createdAt ?? 0) - (a[1]?.updatedAt ?? a[1]?.createdAt ?? 0))

    if (candidates.length > 0) {
      return { key: candidates[0][0], entry: candidates[0][1] }
    }
  }

  return { key: null, entry: null }
}

async function clearDualWieldOpeningAdvantage (key) {
  if (!key) return
  const ledger = await getDualWieldLedger()
  if (!ledger[key]) return
  delete ledger[key]
  await setDualWieldLedger(ledger)
}

async function clearOpposedLedgerForDualWieldFollowUp (attackerRef) {
  if (!attackerRef) return

  const combat = game.combats.active
  if (!combat) return

  const ledger = await getOpposedLedger()
  let changed = false

  const attackerMatchKey =
    attackerRef?.combatantId
    ?? attackerRef?.tokenUuid
    ?? attackerRef?.tokenId
    ?? attackerRef?.actorId
    ?? null

  for (const [key, entry] of Object.entries(ledger)) {
    const entryAttackerKey =
      entry?.attackerRef?.combatantId
      ?? entry?.attackerRef?.tokenUuid
      ?? entry?.attackerRef?.tokenId
      ?? entry?.attackerActorId
      ?? null

    const sameAttacker = entryAttackerKey === attackerMatchKey
    const sameRound = entry?.round === (combat.round ?? null)
    const sameTurn = entry?.turn === (combat.turn ?? null)

    if (!sameAttacker || !sameRound || !sameTurn) continue

    // Invalida l'applicazione precedente, così il follow-up può essere valutato di nuovo
    entry.applied = null
    entry.lastWinnerSide = null
    entry.updatedAt = Date.now()
    ledger[key] = entry
    changed = true
  }

  if (changed) {
    await setOpposedLedger(ledger)
    GMToolkit.log(true, "Opposed ledger cleared for Dual Wield follow-up.", { attackerRef })
  }
}

async function consumeDualWieldOpeningAdvantage ({
  sourceMessage = null,
  attackerRef = null
} = {}) {
  const { key, entry } = await findDualWieldOpeningAdvantage({
    attackerRef,
    sourceMessageId: sourceMessage?.id ?? null
  })

  if (!key || !entry || entry.consumed) return false

  const combatant = getCombatantByTokenRef(entry.attackerRef)
  const token = getTokenObjectForCombatant(combatant)
  if (!combatant || !token) {
    await clearDualWieldOpeningAdvantage(key)
    return false
  }

  const currentAdvantage = Number(token.actor?.system?.status?.advantage?.value ?? 0)
  if (currentAdvantage > 0) {
    await Advantage.update(token, -1, "dualWieldConsume")
  }

  await clearOpposedLedgerForDualWieldFollowUp(entry.attackerRef)

  const ledger = await getDualWieldLedger()
  if (ledger[key]) {
    ledger[key].consumed = true
    ledger[key].consumedAt = Date.now()
    await setDualWieldLedger(ledger)
  }

  await clearDualWieldOpeningAdvantage(key)
  GMToolkit.log(true, `Dual Wield opening advantage consumed for ${token.name}.`)
  return true
}

async function cleanupStaleDualWieldLedger () {
  const combat = game.combats.active
  if (!combat) return

  const ledger = await getDualWieldLedger()
  let changed = false

  for (const [key, entry] of Object.entries(ledger)) {
    const sameRound = entry?.round === (combat.round ?? null)
    const sameTurn = entry?.turn === (combat.turn ?? null)
    if (sameRound && sameTurn) continue

    delete ledger[key]
    changed = true
  }

  if (changed) await setDualWieldLedger(ledger)
}

function isResidualDualWielderEffect(effect) {
  const name = String(effect?.name ?? "").toLowerCase().trim()
  const label = String(effect?.label ?? "").toLowerCase().trim()
  const conditionId = String(effect?.conditionId ?? "").toLowerCase().trim()

  const statuses = Array.from(effect?.statuses ?? []).map(s => String(s).toLowerCase().trim())

  return (
    name === "dual wielder"
    || label === "dual wielder"
    || conditionId === "dualwielder"
    || statuses.includes("dualwielder")
  )
}

async function clearResidualDualWielderEffectsFromCombat (combat) {
  if (!combat) return

  const actors = new Map()

  for (const combatant of combat.combatants) {
    const actor = combatant?.actor
    if (actor?.id) actors.set(actor.id, actor)
  }

  for (const actor of actors.values()) {
    let removed = false

    // Via preferenziale: condition di sistema WFRP
    if (typeof actor.hasCondition === "function" && actor.hasCondition("dualwielder")) {
      if (typeof actor.removeCondition === "function") {
        await actor.removeCondition("dualwielder")
        removed = true
      }
    }

    // Fallback: rimozione ActiveEffect residui
    const effectsToRemove = actor.effects
      .filter(effect => isResidualDualWielderEffect(effect))
      .map(effect => effect.id)
      .filter(Boolean)

    if (effectsToRemove.length) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", effectsToRemove)
      removed = true
    }

    if (removed) {
      GMToolkit.log(true, `Residual Dual Wielder effects cleared for ${actor.name}.`)
    }
  }

  await setDualWieldLedger({})
}

function normalizeActionText (value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function isDualWieldFollowUpControl (element) {
  if (!element) return false

  const datasetAction = String(element.dataset?.action ?? "").toLowerCase()

  // PRIORITÀ ASSOLUTA: check strutturato (robusto)
  if (datasetAction === "rolldualwielder") return true

  // fallback testuale (nel caso cambino HTML)
  const text = String(
    element.textContent ??
    element.innerText ??
    element.getAttribute?.("title") ??
    element.getAttribute?.("aria-label") ??
    ""
  ).toLowerCase().replace(/\s+/g, " ").trim()

  return [
    "dual wielder attack",
    "dual wield attack",
    "offhand",
    "arma secondaria",
    "improvvisata"
  ].some(p => text.includes(p))
}

async function reconcileOpposedTestAdvantage ({
  messageId,
  attackerRef,
  defenderRef,
  winnerSide,
  announce = true
}) {
  if (!game.user.isUniqueGM) return
  if (!messageId) return
  if (!attackerRef || !defenderRef) return
  if (!["attacker", "defender"].includes(winnerSide)) return
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateOpposedTestAdvantage")) return

  const combat = game.combats.active
  if (!combat) return

  const attackerCombatant = getCombatantByTokenRef(attackerRef)
  const defenderCombatant = getCombatantByTokenRef(defenderRef)
  if (!attackerCombatant || !defenderCombatant) {
    GMToolkit.log(true, "Unable to resolve opposed test combatants.", { messageId, attackerRef, defenderRef })
    return
  }

  const attackerToken = getTokenObjectForCombatant(attackerCombatant)
  const defenderToken = getTokenObjectForCombatant(defenderCombatant)
  if (!attackerToken || !defenderToken) {
    GMToolkit.log(true, "Unable to resolve opposed test token objects.", { messageId, attackerRef, defenderRef })
    return
  }

  const ledger = await getOpposedLedger()
  const ledgerKey = resolveOpposedLedgerKey({
    ledger,
    rawMessageId: messageId,
    attackerRef,
    defenderRef
  })

  const entry = ledger[ledgerKey] ?? {
    attackerActorId: attackerCombatant.actor?.id ?? attackerRef.actorId ?? null,
    defenderActorId: defenderCombatant.actor?.id ?? defenderRef.actorId ?? null,
    attackerRef: foundry.utils.deepClone(attackerRef),
    defenderRef: foundry.utils.deepClone(defenderRef),
    round: combat.round ?? null,
    turn: combat.turn ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawMessageIds: [],
    lastWinnerSide: null,
    applied: null
  }

  entry.attackerActorId = attackerCombatant.actor?.id ?? attackerRef.actorId ?? null
  entry.defenderActorId = defenderCombatant.actor?.id ?? defenderRef.actorId ?? null
  entry.attackerRef = foundry.utils.deepClone(attackerRef)
  entry.defenderRef = foundry.utils.deepClone(defenderRef)
  entry.round = combat.round ?? null
  entry.turn = combat.turn ?? null
  entry.updatedAt = Date.now()

  if (!Array.isArray(entry.rawMessageIds)) entry.rawMessageIds = []
  if (!entry.rawMessageIds.includes(messageId)) {
    entry.rawMessageIds.push(messageId)
  }

  if (entry.applied && entry.lastWinnerSide === winnerSide) {
    ledger[ledgerKey] = entry
    await setOpposedLedger(ledger)
    GMToolkit.log(true, `Opposed ledger already synced for key ${ledgerKey}.`)
    return
  }

  if (entry.applied) {
    const previousWinnerCombatant = getCombatantByTokenRef(entry.applied.winnerRef)
    const previousLoserCombatant = getCombatantByTokenRef(entry.applied.loserRef)

    const previousWinnerToken = getTokenObjectForCombatant(previousWinnerCombatant)
    const previousLoserToken = getTokenObjectForCombatant(previousLoserCombatant)

    if (previousWinnerToken && entry.applied.winnerDelta) {
      await Advantage.update(previousWinnerToken, -Math.abs(entry.applied.winnerDelta), "opposedLedger")
    }

    if (!game.settings.get("wfrp4e", "useGroupAdvantage") && previousLoserToken && entry.applied.loserDelta) {
      await Advantage.update(previousLoserToken, Math.abs(entry.applied.loserDelta), "opposedLedger")
    }
  }

  const winnerCombatant = winnerSide === "attacker" ? attackerCombatant : defenderCombatant
  const loserCombatant = winnerSide === "attacker" ? defenderCombatant : attackerCombatant

  const winnerToken = getTokenObjectForCombatant(winnerCombatant)
  const loserToken = getTokenObjectForCombatant(loserCombatant)
  if (!winnerToken || !loserToken) return

  GMToolkit.log(true, "Reconciling opposed test advantage", {
    messageId,
    attackerRef,
    defenderRef,
    winnerSide,
    groupAdvantage: game.settings.get("wfrp4e", "useGroupAdvantage"),
    previousApplied: entry.applied,
    winnerCombatant: winnerCombatant?.actor?.name,
    loserCombatant: loserCombatant?.actor?.name
  })

  let winnerDelta = 1
  if (
    game.settings.get("wfrp4e", "useGroupAdvantage") === true
    && winnerCombatant.id !== attackerCombatant.id
  ) {
    winnerDelta = 0
    GMToolkit.log(true, "No advantage gained for winning an opposed test you did not initiate.")
  }

  const loserCurrent = !game.settings.get("wfrp4e", "useGroupAdvantage")
    ? Number(loserToken.actor.status.advantage.value ?? 0)
    : 0

  const loserDelta = !game.settings.get("wfrp4e", "useGroupAdvantage")
    ? -loserCurrent
    : 0

  GMToolkit.log(true, "Applying reconciled advantage deltas", {
    winner: winnerCombatant?.actor?.name,
    loser: loserCombatant?.actor?.name,
    winnerDelta,
    winnerCurrentAdvantage: winnerCombatant?.actor?.system?.status?.advantage?.value,
    loserCurrentAdvantage: loserCombatant?.actor?.system?.status?.advantage?.value
  })

  if (!game.settings.get("wfrp4e", "useGroupAdvantage") && loserDelta !== 0) {
    await Advantage.update(loserToken, loserDelta, "opposedLedger")
  }

  if (winnerDelta !== 0) {
    await Advantage.update(winnerToken, winnerDelta, "opposedLedger")
  }

  entry.lastWinnerSide = winnerSide
  entry.applied = {
    winnerRef: foundry.utils.deepClone(getTokenRefFromCombatant(winnerCombatant)),
    loserRef: foundry.utils.deepClone(getTokenRefFromCombatant(loserCombatant)),
    winnerActorId: winnerCombatant.actor?.id ?? null,
    loserActorId: loserCombatant.actor?.id ?? null,
    winnerDelta,
    loserDelta
  }
  ledger[ledgerKey] = entry
  await setOpposedLedger(ledger)

  if (announce) {
    const winnerName = winnerCombatant.actor?.name ?? winnerCombatant.name
    const loserName = loserCombatant.actor?.name ?? loserCombatant.name
    GMToolkit.log(true, `Opposed ledger synced: ${winnerName} over ${loserName}.`)
  }
}

Hooks.once("ready", () => {
  if (window.__gmToolkitDualWieldClickBound) return
  window.__gmToolkitDualWieldClickBound = true

  document.addEventListener("click", async event => {
    const control = event.target?.closest?.("button, a")
    if (!control) return
    if (!isDualWieldFollowUpControl(control)) return

    const messageEl = control.closest(".message")
    const messageId = messageEl?.dataset?.messageId
    if (!messageId) {
      GMToolkit.log(true, "Dual Wield follow-up click detected, but no messageId found on chat message element.")
      return
    }

    const message = game.messages?.get(messageId)
    if (!message) {
      GMToolkit.log(true, `Dual Wield follow-up click detected, but ChatMessage ${messageId} was not found.`)
      return
    }

    const combat = game.combats.active
    const activeCombatant =
      combat?.combatant
      ?? combat?.turns?.[combat?.turn ?? -1]
      ?? null

    const attackerRef = activeCombatant
      ? getTokenRefFromCombatant(activeCombatant)
      : null

    GMToolkit.log(true, "Dual Wield follow-up click intercepted.", {
      messageId,
      datasetAction: control.dataset?.action,
      attackerRef
    })

    const consumed = await consumeDualWieldOpeningAdvantage({
      attackerRef
    })

    GMToolkit.log(true, "Dual Wield follow-up consume result:", consumed)
  }, true)
})

Hooks.on("wfrp4e:applyDamage", async function (scriptArgs) {
  if (!game.user.isUniqueGM) return

  GMToolkit.log(false, scriptArgs)
  if (!scriptArgs.opposedTest.defenderTest.context.unopposed) return // Only apply when Outmanouevring (ie, damage from an unopposed test).
  if (scriptArgs.opposedTest.attackerTest.preData.dualWielding) return // Exit if this is the first strike when Dual Wielding
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateDamageAdvantage")) return
  if (!inActiveCombat(scriptArgs.opposedTest.attackerTest.actor)
    || !inActiveCombat(scriptArgs.opposedTest.defenderTest.actor)) return // Exit if either actor is not in the active combat 

  const uiNotice = `${game.i18n.format("GMTOOLKIT.Advantage.Automation.Outmanoeuvre", { actorName: scriptArgs.actor.name, attackerName: scriptArgs.attacker.name, totalWoundLoss: scriptArgs.totalWoundLoss })}`
  const message = uiNotice
  const type = "success"
  const options = { permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"), console: true }

  if (game.user.isGM) { ui.notifications.notify(message, type, options) }

  const defenderRef = getTokenRefFromTest(scriptArgs.opposedTest?.defenderTest, scriptArgs.actor)
  const attackerRef = getTokenRefFromTest(scriptArgs.opposedTest?.attackerTest, scriptArgs.attacker)

  const defenderCombatant = getCombatantByTokenRef(defenderRef)
  const attackerCombatant = getCombatantByTokenRef(attackerRef)

  const defenderToken = getTokenObjectForCombatant(defenderCombatant)
  const attackerToken = getTokenObjectForCombatant(attackerCombatant)

  if (!defenderToken || !attackerToken) {
    GMToolkit.log(true, "Unable to resolve tokens during wfrp4e:applyDamage", { defenderRef, attackerRef })
    return
  }

  // Clear advantage on actor that has taken damage when not using Group Advantage
  if (!game.settings.get("wfrp4e", "useGroupAdvantage")) {
    await Advantage.update(defenderToken, "clear", "wfrp4e:applyDamage")
  }

  // Increase advantage on actor that dealt damage, as long as it has not already been updated for this test
  if (attackerCombatant.getFlag(GMToolkit.MODULE_ID, "advantage")?.outmanoeuvre !== scriptArgs.opposedTest.attackerTest.message.id) {
    await Advantage.update(attackerToken, "increase", "wfrp4e:applyDamage")

    if (!attackerToken.actor.isOwner) {
      await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
        type: "setFlag",
        payload: {
          character: attackerCombatant,
          updateData: {
            flag: "advantage",
            key: "outmanoeuvre",
            value: scriptArgs.opposedTest.attackerTest.message.id
          }
        }
      })
    } else {
      await attackerCombatant.setFlag(GMToolkit.MODULE_ID, "advantage", { outmanoeuvre: scriptArgs.opposedTest.attackerTest.message.id })
    }
  } else {
    GMToolkit.log(true, `Advantage increase already applied to ${attackerToken.name} for outmanoeuvring.`)
  }

  GMToolkit.log(false, "Outmanoeuvring Advantage: Finished.")
})

Hooks.on("wfrp4e:opposedTestResult", async function (opposedTest, attackerTest, defenderTest) {
  if (!game.user.isUniqueGM) return

  GMToolkit.log(true, "wfrp4e:opposedTestResult", opposedTest, attackerTest, defenderTest)

  // For Group Advantage, handle tests which should not generate advantage
  if (
    game.settings.get("wfrp4e", "useGroupAdvantage")
    && attackerTest.data?.result?.options?.preventAdvantage === true
  ) {
    GMToolkit.log(true, "No advantage gained for winning an opposed test that should not generate advantage.")
    return
  }

  const attackerRef = getTokenRefFromTest(attackerTest, opposedTest?.attacker)
  const defenderRef = getTokenRefFromTest(defenderTest, opposedTest?.defender)
  const attackerCombatant = getCombatantByTokenRef(attackerRef)
  const defenderCombatant = getCombatantByTokenRef(defenderRef)

  // CHARGING: keep existing behavior, but token-safe
  if (!game.settings.get("wfrp4e", "useGroupAdvantage")) {
    if (attackerCombatant && (attackerTest.data.preData?.charging || attackerTest.data.result.other === game.i18n.localize("Charging"))) {
      if (!attackerTest.actor.isOwner) {
        await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
          type: "setFlag",
          payload: {
            character: attackerCombatant,
            updateData: {
              flag: "advantage",
              key: "charging",
              value: opposedTest.attackerTest.message.id
            }
          }
        })
      } else {
        await attackerCombatant.setFlag(GMToolkit.MODULE_ID, "advantage", { charging: opposedTest.attackerTest.message.id })
      }
    }

    if (defenderCombatant && (defenderTest.data.preData?.charging || defenderTest.data.result.other === game.i18n.localize("Charging"))) {
      if (!defenderTest.actor.isOwner) {
        await game.socket.emit(`module.${GMToolkit.MODULE_ID}`, {
          type: "setFlag",
          payload: {
            character: defenderCombatant,
            updateData: {
              flag: "advantage",
              key: "charging",
              value: opposedTest.attackerTest.message.id
            }
          }
        })
      } else {
        await defenderCombatant.setFlag(GMToolkit.MODULE_ID, "advantage", { charging: opposedTest.attackerTest.message.id })
      }
    }
  }

  // WINNING: reconcile the final state for this specific opposed test
  if (defenderTest.context.unopposed) return
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateOpposedTestAdvantage")) return

  const attacker = attackerTest.actor
  const defender = defenderTest.actor
  if (!inActiveCombat(attacker) || !inActiveCombat(defender)) return
  if (!attackerRef || !defenderRef) {
    GMToolkit.log(true, "Unable to build token refs for opposed test.", { attackerRef, defenderRef })
    return
  }

  const messageId = getOpposedMessageId(opposedTest, attackerTest, defenderTest)
  const winnerSide = opposedTest?.result?.winner

  await reconcileOpposedTestAdvantage({
    messageId,
    attackerRef,
    defenderRef,
    winnerSide,
    announce: true
  })

  // Dual Wield opening attack:
  // assegna subito il vantaggio tramite reconcile sopra,
  // ma salva un marcatore per toglierlo se il follow-up viene davvero lanciato
  if (
    !game.settings.get("wfrp4e", "useGroupAdvantage")
    && attackerTest.data?.result?.canDualWield === true
    && winnerSide === "attacker"
  ) {
    await setDualWieldOpeningAdvantage({
      attackerRef,
      sourceMessageId: attackerTest?.message?.id ?? null
    })
  }
})

// Intercept when an actor gets a condition during combat
Hooks.on("createActiveEffect", async function (conditionEffect) {
  GMToolkit.log(false, conditionEffect)
  // GUARDS. Exit if ...
  if (!game.settings.get(GMToolkit.MODULE_ID, "automateConditionAdvantage")) return // ... not using condition automation
  if (game.settings.get("wfrp4e", "useGroupAdvantage")) return // ... Group Advantage is in play
  if (!game.user.isUniqueGM) return // ... not a GM
  if (!conditionEffect.parent.inCombat) return // ... not in combat
  if (!conditionEffect.isCondition) return // ... not a system recognised condition
  const nonConditions = ["dead", "fear", "grappling", "engaged"]
  const condId = conditionEffect.conditionId
  if (nonConditions.includes(condId)) return // ... not a core rules combat condition

  // Clear Advantage
  const token = canvas.tokens.placeables.filter(
    t => conditionEffect.parent.id === (t?.actor?.id || t?.document?.id)
  )[0]
  await Advantage.update(token, "clear", "createActiveEffect")

  // Notification declarations
  const uiNotice = `${game.i18n.format("GMTOOLKIT.Advantage.Automation.Condition", { character: conditionEffect.parent.name, condition: conditionEffect.displayLabel })}`
  const message = uiNotice
  const type = "info"
  const options = {
    permanent: game.settings.get(GMToolkit.MODULE_ID, "persistAdvantageNotifications"),
    console: true
  }
  if (game.user.isGM) { ui.notifications.notify(message, type, options) }
})

Hooks.on("createCombatant", function (combatant) {
  // ADDING TO COMBAT: clear token Advantage only if enabled, and Group Advantage is not being used.
  // If Group Advantage is used, the system handles syncing individual advantage with the group
  if (game.user.isUniqueGM && game.settings.get(GMToolkit.MODULE_ID, "clearAdvantageCombatJoin") && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    const token = canvas.tokens.placeables
      .filter(a => a.id === combatant.tokenId)[0]
    Advantage.update(token, "clear", "createCombatant")
    Advantage.unsetFlags([combatant])
  }
})

Hooks.on("deleteCombatant", function (combatant) {
  if (game.user.isUniqueGM && game.settings.get(GMToolkit.MODULE_ID, "clearAdvantageCombatLeave")) {
    const token = canvas.tokens.placeables
      .filter(a => a.id === combatant.tokenId)[0]
    Advantage.update(token, "clear", "deleteCombatant")
  }
})

Hooks.on("preUpdateCombat", async function (combat, change) {
  if (!game.user.isUniqueGM || !combat.combatants.size || !change.round) return
  if (!(change.round > combat.round)) return // Exit if not advancing combat round, including going backwards through combat
  if (!combat.started) return // Exit when beginning combat; prevents loseMomentum firing prematurely

  // Lose Momentum: proceed only if enabled, and Group Advantage is not being used
  if (game.settings.get(GMToolkit.MODULE_ID, "promptMomentumLoss")
    && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    GMToolkit.log(false, "preUpdateCombat: compare Advantage at start and end of round")
    Advantage.loseMomentum(combat)
  }
})

Hooks.on("deleteCombat", async function (combat) {
  if (!game.user.isUniqueGM) return
  await clearResidualDualWielderEffectsFromCombat(combat)
})

Hooks.on("updateCombat", async function (combat, change) {
  if (!combat.round || !game.user.isUniqueGM || !combat.combatants.size) return
  
    // Inizio combattimento: pulizia residui Dual Wielder da combattimenti interrotti
  if (change.round === 1 && change.turn === 0) {
    await clearResidualDualWielderEffectsFromCombat(combat)
  }

  if (change.turn || change.round) {
    await cleanupStaleDualWieldLedger()
  }

  if (!change.round) return // Exit if this isn't the start of a round

  // Clear Advantage flags when the combat round changes
  // Still required when Group Advantage is used because of Opposed Test flags
  GMToolkit.log(true, "updateCombat: unsetting Advantage flags")
  const advFlagged = combat.combatants.filter(c => c.getFlag(GMToolkit.MODULE_ID, "advantage"))
  if (advFlagged.length) await Advantage.unsetFlags(advFlagged)

  GMToolkit.log(false, "updateCombat: Setting startOfRound flag")
  // Skip individual start of round Advantage tracking if Group Advantage is being used
  if (combat.turns && combat.isActive && !game.settings.get("wfrp4e", "useGroupAdvantage")) {
    combat.combatants.forEach(async c => {
      await c.setFlag(GMToolkit.MODULE_ID, "sorAdvantage", c.token.actor.system.status.advantage.value)
      GMToolkit.log(false, `${c.name}:  ${c.getFlag(GMToolkit.MODULE_ID, "sorAdvantage")}`)
    })
  }
})