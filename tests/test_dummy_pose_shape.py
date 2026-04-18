from dex_forge.dummy_pose_publisher import build_dummy_pose_array


def test_dummy_pose_array_roughly_matches_a_hand_shape():
    message = build_dummy_pose_array(hand="left", tick=8)

    wrist = message.poses[0].position
    thumb_tip = message.poses[4].position
    index_tip = message.poses[8].position
    middle_tip = message.poses[12].position
    ring_tip = message.poses[16].position
    pinky_tip = message.poses[20].position
    palm_outer = message.poses[24].position

    assert len(message.poses) == 25
    assert thumb_tip.x > wrist.x
    assert index_tip.y > wrist.y
    assert middle_tip.y > wrist.y
    assert ring_tip.y > wrist.y
    assert pinky_tip.y > wrist.y
    assert pinky_tip.x < index_tip.x
    assert palm_outer.x < index_tip.x
